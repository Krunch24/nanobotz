"""Private child process: stdout is a JSON protocol, never server logs."""
import contextlib
import inspect
import json
import os
from pathlib import Path
import sys


def main():
    payload = json.load(sys.stdin)
    source = Path(os.environ['NANO_SOURCE_DIR']).resolve()
    work = Path(os.environ['NANO_SESSION_DIR']).resolve()
    os.chdir(work)
    os.environ['NANO_DATA_DIR'] = str(work)
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    sys.path.insert(0, str(source))
    # Some original modules print prompts/state. Suppress both output channels.
    with open(os.devnull, 'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
        from ai import NanoAI
        nano = NanoAI()
        if payload.get('probe'):
            result = {'ready': callable(getattr(nano, 'chat', None))}
        else:
            response = nano.chat(payload['message'])
            if inspect.isawaitable(response):
                import asyncio
                response = asyncio.run(response)
            if not isinstance(response, str) or not response.strip() or len(response) > 100000:
                raise ValueError('NanoAI.chat must return a nonempty string of at most 100000 characters')
            result = {'response': response.strip()}
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        # Never emit exception values: original modules may embed prompts or secrets.
        print(json.dumps({'error': 'Original Nano controller failed; review its integration privately.'}))
        sys.exit(1)
