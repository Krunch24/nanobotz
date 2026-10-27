"""Explicit live test: writes one real Nano interaction and reports no chat text."""
import argparse
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from uuid import uuid4


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--accept-test-memory-write', action='store_true')
    args = parser.parse_args()
    if not args.accept_test_memory_write:
        parser.error('This test calls Nano and may change test-session memory. Use --accept-test-memory-write to proceed.')
    base = os.environ.get('NANO_API_URL', '')
    key = os.environ.get('NANO_API_KEY', '')
    if not base.startswith('https://') or len(key) < 32:
        raise SystemExit('Set NANO_API_URL and NANO_API_KEY privately before testing.')
    sid = hashlib.sha256(str(uuid4()).encode()).hexdigest()
    def call(path, body=None):
        request = urllib.request.Request(base.rstrip('/') + path,
            data=json.dumps(body).encode() if body else None,
            headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Nano-Client': sid})
        with urllib.request.urlopen(request, timeout=15) as response:
            return json.load(response)
    try:
        assert call('/health')['ready'] is True
        job = call('/api/chat', {'message': 'Hello Nano. This is a deployment verification. Please reply briefly.', 'sessionId': sid, 'requestId': str(uuid4())})
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            result = call('/api/chat/status?' + urllib.parse.urlencode({'sessionId': sid, 'jobId': job['jobId']}))
            if result['status'] == 'completed':
                assert isinstance(result['response'], str) and result['response'].strip()
                print('PASS: ready health, authenticated submission, polling, and nonempty real Nano response.')
                return
            if result['status'] == 'failed':
                raise RuntimeError()
            time.sleep(2)
        raise TimeoutError()
    except Exception:
        raise SystemExit('FAIL: live validation did not complete. Inspect server readiness and private integration diagnostics; no response or credential was printed.')


if __name__ == '__main__':
    main()
