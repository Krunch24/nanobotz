"""Optional Linux CLI helper to integrate into the ORIGINAL llm.py after review.
Never used as an alternative to NanoAI.chat(). No identity prompt is invented here.
"""
import os
import subprocess
from backend.config import settings


def generate(prompt: str) -> str:
    cfg = settings()
    result = subprocess.run(
        [str(cfg['llama']), '-m', str(cfg['model']), '-p', prompt,
         '-n', '512', '-c', '4096', '--single-turn', '--no-display-prompt',
         '--simple-io', '--log-disable'],
        capture_output=True, text=True, timeout=cfg['timeout'], check=True,
        env={**os.environ, 'LLAMA_LOG_LEVEL': 'error'},
    )
    response = result.stdout.strip()
    if not response:
        raise RuntimeError('Inference returned no text')
    return response
