#!/usr/bin/env python3
from pathlib import Path
import shutil
from datetime import datetime

downloads = Path('/Users/min/Downloads')
inbox = Path('/Users/min/.openclaw/workspaces/seogi/promoted/inbox')
inbox.mkdir(parents=True, exist_ok=True)

patterns = ['PROMOTION_DASHBOARD*.md']
files = []
for pat in patterns:
    files.extend(downloads.glob(pat))

moved = 0
for p in sorted(files, key=lambda x: x.stat().st_mtime):
    if not p.is_file():
        continue
    ts = datetime.fromtimestamp(p.stat().st_mtime).strftime('%Y%m%d-%H%M%S')
    name = f'{p.stem}-{ts}{p.suffix}' if p.name == 'PROMOTION_DASHBOARD.md' else p.name
    target = inbox / name
    shutil.move(str(p), str(target))
    moved += 1

print(f'Imported {moved} exported dashboard file(s) to promoted/inbox.')
