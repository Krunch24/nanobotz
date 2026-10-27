"""Single-process API with a durable bounded queue on the Linux persistent disk."""
import asyncio
from contextlib import asynccontextmanager
import fcntl
import hashlib
import hmac
import logging
import os
import re
from pathlib import Path
import shutil
import sqlite3
import time
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field

from backend.config import settings
from backend.runtime import child, readiness

log = logging.getLogger('nano')


class Chat(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    message: str = Field(min_length=1, max_length=4000)
    sessionId: str = Field(pattern=r'^[A-Za-z0-9_-]{16,128}$')
    requestId: str = Field(default_factory=lambda: str(uuid4()), pattern=r'^[a-f0-9-]{36}$')


def connection(app):
    db = sqlite3.connect(app.state.db_path, timeout=5)
    db.row_factory = sqlite3.Row
    return db


def session_path(app, sid):
    # IDs are opaque HMACs from the trusted proxy, never user-controlled paths.
    return app.state.cfg['data'] / 'sessions' / hashlib.sha256(sid.encode()).hexdigest()


async def worker(app):
    while True:
        with connection(app) as db:
            row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE jobs SET status='running' WHERE id=?", (row['id'],))
        if not row:
            await asyncio.sleep(.25)
            continue
        started = time.monotonic()
        try:
            work = session_path(app, row['session'])
            work.mkdir(parents=True, exist_ok=True, mode=0o700)
            # Serialized worker prevents simultaneous writes by original JSON modules.
            # Keep a bounded pre-generation recovery snapshot without overwriting originals.
            backup = app.state.cfg['data'] / 'backups' / work.name
            backup.mkdir(parents=True, exist_ok=True)
            dest = backup / str(time.time_ns())
            await asyncio.to_thread(shutil.copytree, work, dest, symlinks=True)
            for old in sorted(backup.iterdir())[:-3]:
                await asyncio.to_thread(shutil.rmtree, old)
            result = await child(app.state.cfg, work, {'message': row['message']})
            with connection(app) as db:
                db.execute("UPDATE jobs SET status='completed',response=?,message=NULL WHERE id=?", (result['response'], row['id']))
            log.info('generation_completed job=%s duration=%.1f', row['id'], time.monotonic() - started)
        except asyncio.CancelledError:
            with connection(app) as db:
                db.execute("UPDATE jobs SET status='failed',error='Server restarted during generation.',message=NULL WHERE id=?", (row['id'],))
            raise
        except Exception as exc:
            # Exception text/tracebacks from original Nano code may expose conversations.
            log.warning('generation_failed job=%s category=%s', row['id'], type(exc).__name__)
            with connection(app) as db:
                db.execute("UPDATE jobs SET status='failed',error='Nano generation failed or timed out. Please try again.',message=NULL WHERE id=?", (row['id'],))


@asynccontextmanager
async def lifespan(app):
    cfg = settings()
    os.umask(0o077)
    cfg['data'].mkdir(parents=True, exist_ok=True)
    lock = (cfg['data'] / 'server.lock').open('a')
    # Multiple API processes would violate shared-file serialization: fail fast.
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    app.state.cfg = cfg
    app.state.db_path = cfg['data'] / 'jobs.sqlite3'
    with connection(app) as db:
        db.executescript('''
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY, session TEXT NOT NULL, request TEXT NOT NULL,
            message TEXT, status TEXT NOT NULL, response TEXT, error TEXT, created REAL NOT NULL,
            UNIQUE(session,request));
          CREATE INDEX IF NOT EXISTS jobs_session ON jobs(session,status);
          CREATE TABLE IF NOT EXISTS rates (bucket TEXT, window INTEGER, hits INTEGER,
            PRIMARY KEY(bucket,window));
        ''')
        # Never replay interrupted requests: they might already have changed memory.
        db.execute("UPDATE jobs SET status='failed',error='Server restarted; submit a new message.',message=NULL WHERE status IN ('queued','running')")
    app.state.checks = {'ready': False, 'application_ready': True, 'model_ready': False,
                        'engine_ready': False, 'controller_ready': False}
    async def initialize():
        try:
            app.state.checks = await readiness(cfg)
        except Exception:
            log.warning('startup_validation_failed')
        log.info('startup_validation ready=%s', app.state.checks['ready'])
    probe = asyncio.create_task(initialize())
    task = asyncio.create_task(worker(app))
    app.state.worker = task
    try:
        yield
    finally:
        probe.cancel()
        task.cancel()
        await asyncio.gather(probe, task, return_exceptions=True)
        lock.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)


@app.exception_handler(RequestValidationError)
async def invalid_request(request, exc):
    return JSONResponse({'detail': 'Invalid JSON fields: provide a 1–4000 character message and a valid session ID.'}, status_code=422)


async def authenticate(request: Request, authorization: str = Header(default='')):
    key = request.app.state.cfg['key']
    if len(key) < 32 or not hmac.compare_digest(authorization.encode(), ('Bearer ' + key).encode()):
        raise HTTPException(401, 'Missing or invalid backend credentials.')


def limit(request, client, kind):
    if not client or len(client) != 64 or any(c not in '0123456789abcdef' for c in client):
        raise HTTPException(400, 'Missing trusted client identity.')
    now = int(time.time() // 60)
    cap = 10 if kind == 'submit' else 180
    bucket = kind + ':' + client
    with connection(request.app) as db:
        db.execute('DELETE FROM rates WHERE window < ?', (now - 2,))
        db.execute('INSERT INTO rates VALUES (?,?,1) ON CONFLICT(bucket,window) DO UPDATE SET hits=hits+1', (bucket, now))
        count = db.execute('SELECT hits FROM rates WHERE bucket=? AND window=?', (bucket, now)).fetchone()[0]
    if count > cap:
        raise HTTPException(429, 'Too many requests. Wait one minute.', headers={'Retry-After': '60'})


@app.middleware('http')
async def body_limit(request, call_next):
    if request.method == 'POST':
        content = bytearray()
        try:
            async with asyncio.timeout(10):
                async for chunk in request.stream():
                    content.extend(chunk)
                    if len(content) > 20000:
                        return JSONResponse({'detail': 'Request too large.'}, status_code=413)
        except TimeoutError:
            return JSONResponse({'detail': 'Request body timed out.'}, status_code=408)
        request._body = bytes(content)
    response = await call_next(request)
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.get('/health')
async def health(request: Request):
    # Public, deliberately contains booleans only, with no paths or credentials.
    cfg = request.app.state.cfg
    if request.app.state.checks['ready'] and (request.app.state.worker.done() or not cfg['model'].is_file() or not os.access(cfg['llama'], os.X_OK)):
        request.app.state.checks['ready'] = False
        request.app.state.checks['model_ready'] = False
    return JSONResponse({'status': 'ok' if request.app.state.checks['ready'] else 'unavailable',
                         **request.app.state.checks}, status_code=200 if request.app.state.checks['ready'] else 503)


@app.post('/api/chat', dependencies=[Depends(authenticate)])
async def submit(body: Chat, request: Request, x_nano_client: str = Header(default='')):
    limit(request, x_nano_client, 'submit')
    with connection(request.app) as db:
        db.execute('DELETE FROM jobs WHERE created < ? AND status NOT IN (\'queued\',\'running\')', (time.time() - 86400,))
        prior = db.execute('SELECT id,status FROM jobs WHERE session=? AND request=?', (body.sessionId, body.requestId)).fetchone()
        if prior:
            return JSONResponse({'jobId': prior['id'], 'status': prior['status']}, status_code=202)
        if not request.app.state.checks['ready'] or request.app.state.worker.done():
            raise HTTPException(503, 'Nano is not ready. The original controller, model, and Linux inference engine must be configured.')
        if db.execute("SELECT count(*) FROM jobs WHERE status IN ('queued','running')").fetchone()[0] >= 8:
            raise HTTPException(429, 'Nano queue is full. Try again shortly.', headers={'Retry-After': '15'})
        if db.execute("SELECT 1 FROM jobs WHERE session=? AND status IN ('queued','running')", (body.sessionId,)).fetchone():
            raise HTTPException(409, 'This session already has an active generation.')
        root = request.app.state.cfg['data'] / 'sessions'
        root.mkdir(exist_ok=True)
        if not session_path(request.app, body.sessionId).exists() and sum(1 for _ in root.iterdir()) >= 1000:
            raise HTTPException(503, 'Session capacity reached. Contact the site owner.')
        job = str(uuid4())
        db.execute("INSERT INTO jobs(id,session,request,message,status,created) VALUES (?,?,?,?,'queued',?)",
                   (job, body.sessionId, body.requestId, body.message, time.time()))
    return JSONResponse({'jobId': job, 'status': 'queued'}, status_code=202)


@app.get('/api/chat/status', dependencies=[Depends(authenticate)])
async def status(request: Request, jobId: str, sessionId: str, x_nano_client: str = Header(default='')):
    limit(request, x_nano_client, 'poll')
    if not re.fullmatch(r'[a-f0-9-]{36}', jobId) or not re.fullmatch(r'[A-Za-z0-9_-]{16,128}', sessionId):
        raise HTTPException(400, 'Invalid job or session.')
    with connection(request.app) as db:
        row = db.execute('SELECT status,response,error FROM jobs WHERE id=? AND session=? AND created>?',
                         (jobId, sessionId, time.time() - 86400)).fetchone()
    if not row:
        raise HTTPException(404, 'Job not found for this session, or expired.')
    return {'jobId': jobId, 'status': row['status'], 'response': row['response'], 'error': row['error']}
