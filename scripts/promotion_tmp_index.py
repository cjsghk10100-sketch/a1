#!/usr/bin/env python3
import json
from pathlib import Path
from datetime import datetime

root = Path('/Users/min/.openclaw/workspaces/seogi')
tmp = root / 'tmp'
out = root / 'apps/promotion-dashboard/tmp_files.json'

items = []
if tmp.exists():
    for p in tmp.rglob('*'):
        if p.is_file():
            st = p.stat()
            rel = p.relative_to(root).as_posix()
            zone = rel.split('/')[1] if rel.startswith('tmp/') and len(rel.split('/'))>1 else 'other'
            items.append({
                'path': rel,
                'zone': zone,
                'size': st.st_size,
                'modified_at': datetime.fromtimestamp(st.st_mtime).strftime('%Y-%m-%d %H:%M:%S')
            })
items.sort(key=lambda x: x['modified_at'], reverse=True)
out.write_text(json.dumps({'files': items}, ensure_ascii=False, indent=2), encoding='utf-8')
print(f'Indexed {len(items)} temp files -> {out}')
