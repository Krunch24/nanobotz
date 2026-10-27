"""Synthetic contract tests. These do not constitute a real Nano/model test."""
import asyncio
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from backend.api import app, connection, session_path
from backend.runtime import readiness, child


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cfg = {'data': Path(self.temp.name), 'source': Path(self.temp.name) / 'source',
                    'model': Path(self.temp.name) / 'missing.gguf', 'llama': Path(self.temp.name) / 'missing-cli',
                    'verified': False, 'timeout': 10, 'key': 'contract-test-placeholder-not-a-real-secret'}
        self.patches = [patch('backend.api.settings', return_value=self.cfg)]
        self.patches[0].start()
        self.headers = {'Authorization': 'Bearer ' + self.cfg['key'], 'X-Nano-Client': 'a' * 64}
        self.client = TestClient(app)
        self.client.__enter__()
        time.sleep(.05)

    def tearDown(self):
        self.client.__exit__(None, None, None)
        for p in self.patches:
            p.stop()
        self.temp.cleanup()

    def payload(self, **changes):
        return {'message': 'Synthetic test input', 'sessionId': 'b' * 64,
                'requestId': str(uuid4()), **changes}

    def test_unavailable_health_is_honest(self):
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.json()['model_ready'])
        self.assertFalse(response.json()['source_ready'])
        self.assertNotIn(self.temp.name, response.text)

    def test_credentials_and_validation(self):
        self.assertEqual(self.client.post('/api/chat', json=self.payload()).status_code, 401)
        self.assertEqual(self.client.get('/api/chat/status?jobId=x&sessionId=x').status_code, 401)
        for change in ({'message': ''}, {'message': ' '}, {'message': 'x' * 4001}, {'sessionId': '../escape'}, {'extra': True}):
            self.assertEqual(self.client.post('/api/chat', json=self.payload(**change), headers=self.headers).status_code, 422)
        self.assertEqual(self.client.post('/api/chat', json=self.payload(), headers=self.headers).status_code, 503)
        self.assertEqual(self.client.post('/api/chat', content=b'x'*20001, headers=self.headers).status_code, 413)

    def test_rate_limit(self):
        for _ in range(10):
            self.assertEqual(self.client.post('/api/chat', json=self.payload(), headers=self.headers).status_code, 503)
        self.assertEqual(self.client.post('/api/chat', json=self.payload(), headers=self.headers).status_code, 429)

    def test_generation_contract_ownership_idempotency_and_restart(self):
        app.state.checks['ready'] = True
        async def synthetic_child(cfg, work, payload):
            marker = work / 'test-memory.txt'
            marker.write_text('synthetic persisted memory')
            return {'response': 'SYNTHETIC TEST RESULT'}
        payload = self.payload()
        with patch('backend.api.child', side_effect=synthetic_child):
            submitted = self.client.post('/api/chat', json=payload, headers=self.headers)
            self.assertEqual(submitted.status_code, 202)
            job = submitted.json()['jobId']
            again = self.client.post('/api/chat', json=payload, headers=self.headers)
            self.assertEqual(again.json()['jobId'], job)
            query = {'jobId': job, 'sessionId': payload['sessionId']}
            for _ in range(100):
                result = self.client.get('/api/chat/status', params=query, headers=self.headers)
                if result.json()['status'] == 'completed':
                    break
                time.sleep(.02)
            self.assertEqual(result.json()['response'], 'SYNTHETIC TEST RESULT')
            wrong = self.client.get('/api/chat/status', params={**query, 'sessionId': 'c'*64}, headers=self.headers)
            self.assertEqual(wrong.status_code, 404)
            path = session_path(app, payload['sessionId']) / 'test-memory.txt'
            self.assertTrue(path.exists())
            self.client.__exit__(None, None, None)
            self.client = TestClient(app)
            self.client.__enter__()
            self.assertEqual(path.read_text(), 'synthetic persisted memory')
            self.assertEqual(self.client.get('/api/chat/status', params=query, headers=self.headers).json()['response'], 'SYNTHETIC TEST RESULT')

    def test_generation_failure_is_terminal(self):
        app.state.checks['ready'] = True
        async def failure(*args):
            raise TimeoutError()
        with patch('backend.api.child', side_effect=failure):
            payload = self.payload()
            job = self.client.post('/api/chat', json=payload, headers=self.headers).json()['jobId']
            for _ in range(100):
                data = self.client.get('/api/chat/status', params={'jobId': job, 'sessionId': payload['sessionId']}, headers=self.headers).json()
                if data['status'] == 'failed':
                    break
                time.sleep(.02)
            self.assertEqual(data['status'], 'failed')
            self.assertIsNone(data['response'])
            with connection(app) as db:
                self.assertIsNone(db.execute('SELECT message FROM jobs WHERE id=?', (job,)).fetchone()[0])

    def test_queue_and_per_session_concurrency_bounds(self):
        app.state.checks['ready'] = True
        async def slow(*args):
            await asyncio.sleep(10)
            return {'response': 'SYNTHETIC'}
        with patch('backend.api.child', side_effect=slow):
            self.assertEqual(self.client.post('/api/chat', json=self.payload(), headers=self.headers).status_code, 202)
            self.assertEqual(self.client.post('/api/chat', json=self.payload(), headers=self.headers).status_code, 409)
            for n in range(7):
                sid = str(n) * 64
                self.assertEqual(self.client.post('/api/chat', json=self.payload(sessionId=sid), headers=self.headers).status_code, 202)
            self.assertEqual(self.client.post('/api/chat', json=self.payload(sessionId='f'*64), headers=self.headers).status_code, 429)

    def test_subprocess_generation_timeout(self):
        source = self.cfg['source']
        source.mkdir()
        (source / 'ai.py').write_text('import time\nclass NanoAI:\n    def chat(self, message):\n        time.sleep(30)\n        return "UNREACHABLE"\n')
        work = Path(self.temp.name) / 'timeout-session'
        work.mkdir()
        started = time.monotonic()
        with self.assertRaises(TimeoutError):
            asyncio.run(child(self.cfg, work, {'message': 'fixture'}, timeout=.05))
        self.assertLess(time.monotonic() - started, 2)

    def test_isolated_real_subprocess_runner_with_fixture_controller(self):
        # A fixture verifies invocation/isolation only; it is not Nano inference.
        source = self.cfg['source']
        source.mkdir()
        (source / 'ai.py').write_text('''from pathlib import Path
class NanoAI:
    def chat(self, message):
        p = Path('fixture-memory.txt')
        n = int(p.read_text()) if p.exists() else 0
        p.write_text(str(n + 1))
        print('private fixture diagnostic')
        return 'FIXTURE-' + str(n + 1)
''')
        one = Path(self.temp.name) / 'one'
        two = Path(self.temp.name) / 'two'
        one.mkdir(); two.mkdir()
        async def run():
            self.assertEqual((await child(self.cfg, one, {'message': 'test'}))['response'], 'FIXTURE-1')
            self.assertEqual((await child(self.cfg, one, {'message': 'test'}))['response'], 'FIXTURE-2')
            self.assertEqual((await child(self.cfg, two, {'message': 'test'}))['response'], 'FIXTURE-1')
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
