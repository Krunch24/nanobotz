"""Download the requested quantization outside Git; require license acceptance.
No credentials are accepted or printed. Authenticated sources should be downloaded
privately and uploaded, then verified against the published digest instead.
"""
import argparse
import hashlib
import os
from pathlib import Path
import urllib.request

REVISION = '067b946cf014b7c697f3654f621d577a3e3afd1c'
FILENAME = 'Llama-3.2-1B-Instruct-Q4_0.gguf'
SHA256 = 'fa0390e7c043f89ae1847bd6682d748041a99d4ef3de0e0b27d33b6af97a8be8'
SIZE = 773025920
URL = f'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/{REVISION}/{FILENAME}'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--accept-llama-license', action='store_true')
    args = parser.parse_args()
    if not args.accept_llama_license:
        parser.error('Review and accept the Llama 3.2 Community License and Acceptable Use Policy first (see README).')
    args.directory.mkdir(parents=True, exist_ok=True)
    dest = args.directory / FILENAME
    if dest.exists():
        raise SystemExit('Destination already exists; no file was overwritten. Verify your existing file privately.')
    temp = dest.with_suffix('.partial')
    digest = hashlib.sha256()
    size = 0
    created = False
    try:
        if temp.exists():
            raise SystemExit('Partial download already exists; inspect it before retrying.')
        with urllib.request.urlopen(URL, timeout=60) as response, temp.open('xb') as output:
            created = True
            while block := response.read(1024 * 1024):
                size += len(block)
                if size > SIZE:
                    raise ValueError('Download exceeded expected size')
                digest.update(block)
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
        if size != SIZE or digest.hexdigest() != SHA256:
            raise ValueError('Model integrity verification failed')
        # Hard-link provides atomic publication and refuses an existing destination.
        os.link(temp, dest)
        print('Model downloaded and SHA-256 verified.')
    finally:
        if created:
            temp.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
