#!/usr/bin/env python3
from pathlib import Path
import shutil

root = Path('/Users/min/.openclaw/workspaces/seogi')
inbox = root / 'promoted' / 'inbox'
applied = root / 'promoted' / 'applied'

targets = {
    'PROMOTION_DASHBOARD.md': root / 'memory' / 'reference' / 'PROMOTION_DASHBOARD.md'
}

inbox.mkdir(parents=True, exist_ok=True)
applied.mkdir(parents=True, exist_ok=True)

moved = 0
for p in inbox.iterdir():
    if not p.is_file():
        continue
    target = targets.get(p.name)
    if target is None:
        continue
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(p, target)
    shutil.move(str(p), str(applied / p.name))
    moved += 1

print(f'Applied {moved} promotion file(s).')
