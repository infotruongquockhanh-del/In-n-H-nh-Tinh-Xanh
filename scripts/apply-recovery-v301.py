#!/usr/bin/env python3
"""Reproducible, source-only patch. Never touches data or deployment settings."""
import json
from pathlib import Path
import subprocess
version=json.loads(Path('package.json').read_text())['version']
if version=='30.1.0':
    print('V30.1 source already applied.')
elif version=='30.0.0':
    subprocess.run(['git','apply','--check','scripts/recovery-v301.patch'],check=True)
    subprocess.run(['git','apply','scripts/recovery-v301.patch'],check=True)
else:
    raise SystemExit('Unexpected source version. Stop rather than overwrite newer changes.')
