import asyncio
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile

REQUIRED = ('ai.py', 'llm.py', 'config.py', 'memory.py', 'state.py', 'growth.py',
            'nano_core.py', 'soul_architecture.py', 'oracle.py', 'profile.py',
            'reflection.py', 'knowledge.py', 'vision_memory.py')


async def child(cfg, work: Path, payload, timeout=None):
    env = {**os.environ, 'NANO_SOURCE_DIR': str(cfg['source']),
           'NANO_MODEL_PATH': str(cfg['model']), 'NANO_LLAMA_PATH': str(cfg['llama']),
           'NANO_SESSION_DIR': str(work)}
    # No web/backend credentials are inherited by the original controller.
    for name in list(env):
        if any(term in name.upper() for term in ('KEY', 'TOKEN', 'SECRET', 'PASSWORD', 'CREDENTIAL')):
            env.pop(name)
    proc = await asyncio.create_subprocess_exec(
        sys.executable, str(Path(__file__).with_name('runner.py')),
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=env, start_new_session=True)
    try:
        output, _ = await asyncio.wait_for(proc.communicate(json.dumps(payload).encode()), timeout or cfg['timeout'])
        if proc.returncode:
            raise RuntimeError('controller_failed')
        result = json.loads(output)
        if result.get('error'):
            raise RuntimeError('controller_failed')
        return result
    finally:
        # Includes descendants (llama-cli), even on timeout or clean server shutdown.
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        await proc.wait()


async def readiness(cfg):
    checks = {'application_ready': True, 'credentials_ready': len(cfg['key']) >= 32,
              'source_ready': all((cfg['source'] / name).is_file() for name in REQUIRED),
              'integration_reviewed': cfg['verified'], 'storage_ready': False,
              'engine_ready': False, 'model_present': False, 'model_ready': False,
              'controller_ready': False}
    try:
        cfg['data'].mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryFile(dir=cfg['data']) as f:
            f.write(b'probe')
        checks['storage_ready'] = True
    except OSError:
        pass
    try:
        with cfg['model'].open('rb') as f:
            checks['model_present'] = f.read(4) == b'GGUF'
    except OSError:
        pass
    try:
        proc = await asyncio.create_subprocess_exec(str(cfg['llama']), '--version', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            checks['engine_ready'] = await asyncio.wait_for(proc.wait(), 10) == 0
        finally:
            if proc.returncode is None:
                proc.kill()
                await proc.wait()
    except (OSError, asyncio.TimeoutError):
        pass
    if all(checks[k] for k in ('source_ready', 'integration_reviewed', 'storage_ready', 'engine_ready', 'model_present')):
        try:
            # Actually load the model; a GGUF magic header alone is not readiness.
            proc = await asyncio.create_subprocess_exec(str(cfg['llama']), '-m', str(cfg['model']),
                '-p', 'Readiness check', '-n', '1', '-c', '512', '--single-turn', '--log-disable',
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            try:
                checks['model_ready'] = await asyncio.wait_for(proc.wait(), cfg['timeout']) == 0
            finally:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await proc.wait()
            with tempfile.TemporaryDirectory(dir=cfg['data'], prefix='probe-') as work:
                checks['controller_ready'] = (await child(cfg, Path(work), {'probe': True})).get('ready') is True
        except (OSError, RuntimeError, ValueError, asyncio.TimeoutError):
            pass
    checks['ready'] = all(checks.values())
    return checks
