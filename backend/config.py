"""Hosting configuration only. Does not replace Nano's original config.py."""
import os
from pathlib import Path


def settings():
    return {
        'source': Path(os.getenv('NANO_SOURCE_DIR', '/opt/nano-source')).resolve(),
        'data': Path(os.getenv('NANO_DATA_DIR', '/var/lib/nano/data')).resolve(),
        'model': Path(os.getenv('NANO_MODEL_PATH', '/var/lib/nano/models/Llama-3.2-1B-Instruct-Q4_0.gguf')).resolve(),
        'llama': Path(os.getenv('NANO_LLAMA_PATH', '/usr/local/bin/llama-cli')).resolve(),
        'verified': os.getenv('NANO_INTEGRATION_VERIFIED') == 'true',
        'timeout': min(600, max(10, int(os.getenv('NANO_GENERATION_TIMEOUT', '240')))),
        'key': os.getenv('NANO_API_KEY', ''),
    }
