#!/usr/bin/env python3
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
md = root / 'memory/reference/PROMOTION_DASHBOARD.md'
out = root / 'apps/promotion-dashboard/data.json'

queue = []
if md.exists():
    lines = md.read_text(encoding='utf-8').splitlines()
    in_queue = False
    for ln in lines:
        if ln.strip().startswith('## Queue'):
            in_queue = True
            continue
        if in_queue and ln.strip().startswith('## '):
            break
        if in_queue and ln.strip().startswith('|'):
            cells = [c.strip() for c in ln.strip('|').split('|')]
            if len(cells) == 6 and cells[0] not in ('proposal_id','---','-'):
                queue.append({
                    'proposal_id': cells[0],
                    'target_path': cells[1],
                    'summary': cells[2],
                    'risk_level': cells[3],
                    'status': cells[4],
                    'created_at': cells[5],
                    'reason': ''
                })

out.write_text(json.dumps({'queue': queue}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Wrote {out} with {len(queue)} queue items')
