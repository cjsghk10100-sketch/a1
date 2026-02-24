#!/usr/bin/env python3
import argparse
import json
import re
import shutil
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Decision:
    file: str
    action: str  # promote|demote|hold
    reasons: list
    kpi: dict
    age_hours: float


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_number(val: str):
    v = val.strip().replace('%', '')
    try:
        num = float(v)
    except ValueError:
        return None
    if '%' in val:
        return num / 100.0
    if num > 1.0:
        # tolerate 0~100 scale inputs
        return num / 100.0
    return num


def parse_file(path: Path):
    text = path.read_text(encoding='utf-8', errors='ignore')

    approval = re.search(r'(?im)^\s*approval_id\s*:\s*(\S+)', text)
    approved_by = re.search(r'(?im)^\s*approved_by\s*:\s*(\S+)', text)
    approved_at = re.search(r'(?im)^\s*approved_at\s*:\s*([^\n]+)', text)
    approval_reason = re.search(r'(?im)^\s*approval_reason\s*:\s*([^\n]+)', text)

    has_approval = approval is not None and approval.group(1).strip().lower() not in {'none', 'null', 'na'}
    has_approval_integrity = all([
        has_approval,
        approved_by is not None and approved_by.group(1).strip() != '',
        approved_at is not None and approved_at.group(1).strip() != '',
        approval_reason is not None and approval_reason.group(1).strip() != '',
    ])

    has_evidence = bool(re.search(r'(?im)^\s*evidence\s*:', text))
    has_eval = bool(re.search(r'(?im)^\s*eval\s*:', text))
    has_learn = bool(re.search(r'(?im)^\s*learn\s*:', text))

    def pick(key: str):
        m = re.search(rf'(?im)^\s*{key}\s*:\s*([^\n]+)', text)
        return parse_number(m.group(1)) if m else None

    kpi = {
        'success_rate': pick('success_rate'),
        'drift': pick('drift'),
        'reproducibility': pick('reproducibility'),
    }

    return {
        'has_approval': has_approval,
        'has_approval_integrity': has_approval_integrity,
        'has_evidence': has_evidence,
        'has_eval': has_eval,
        'has_learn': has_learn,
        'kpi': kpi,
    }


def write_incident(incidents_dir: Path, decision: Decision, dry_run: bool):
    incidents_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    out = incidents_dir / f'INC-{stamp}-{Path(decision.file).stem}.md'
    body = (
        f"# INCIDENT\n\n"
        f"- time_utc: {now_iso()}\n"
        f"- file: {decision.file}\n"
        f"- action: {decision.action}\n"
        f"- reasons: {', '.join(decision.reasons)}\n"
        f"- kpi: {json.dumps(decision.kpi, ensure_ascii=False)}\n"
        f"- age_hours: {decision.age_hours:.2f}\n"
        f"- dry_run: {dry_run}\n"
    )
    if not dry_run:
        out.write_text(body, encoding='utf-8')
    return str(out)


def seed_samples(inbox: Path):
    inbox.mkdir(parents=True, exist_ok=True)
    samples = {
        'PRJ-PIPELINE-PASS_v1.md': """# PASS sample
approval_id: APR-1001
EVIDENCE: command logs attached
EVAL: goal met
LEARN: keep this format
success_rate: 95%
drift: 3%
reproducibility: 100%
""",
        'PRJ-PIPELINE-FAIL-MISSING_v1.md': """# FAIL sample
approval_id: APR-1002
EVIDENCE: exists
success_rate: 92%
drift: 4%
reproducibility: 100%
""",
        'PRJ-PIPELINE-FAIL-KPI_v1.md': """# KPI fail sample
approval_id: APR-1003
EVIDENCE: exists
EVAL: exists
LEARN: exists
success_rate: 70%
drift: 25%
reproducibility: 60%
""",
    }
    for name, content in samples.items():
        p = inbox / name
        if not p.exists():
            p.write_text(content, encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description='Minimal pipeline manager MVP')
    ap.add_argument('--inbox-dir', default='promoted/inbox')
    ap.add_argument('--applied-dir', default='promoted/applied')
    ap.add_argument('--demoted-dir', default='tmp/archive/demoted')
    ap.add_argument('--incidents-dir', default='memory/incidents')
    ap.add_argument('--log-dir', default='tmp/export')
    ap.add_argument('--real-run', action='store_true', help='Perform real file moves')
    ap.add_argument('--confirm-real-run', action='store_true', help='Mandatory second flag for real-run')
    ap.add_argument('--seed-samples', action='store_true')
    ap.add_argument('--require-prefix', default='^(PRJ|IDEA|LOG)-', help='Filename prefix regex gate')

    ap.add_argument('--sla-hours', type=float, default=24.0)
    ap.add_argument('--min-success', type=float, default=0.90)
    ap.add_argument('--max-drift', type=float, default=0.10)
    ap.add_argument('--min-repro', type=float, default=0.90)

    args = ap.parse_args()

    dry_run = True
    if args.real_run and args.confirm_real_run:
        dry_run = False
    elif args.real_run and not args.confirm_real_run:
        print(json.dumps({
            'error': 'real_run_requires_confirm_flag',
            'hint': 'Use both --real-run and --confirm-real-run'
        }, ensure_ascii=False, indent=2))
        return

    inbox = Path(args.inbox_dir)
    applied = Path(args.applied_dir)
    demoted = Path(args.demoted_dir)
    incidents = Path(args.incidents_dir)
    log_dir = Path(args.log_dir)

    if args.seed_samples:
        seed_samples(inbox)

    inbox.mkdir(parents=True, exist_ok=True)
    applied.mkdir(parents=True, exist_ok=True)
    demoted.mkdir(parents=True, exist_ok=True)
    log_dir.mkdir(parents=True, exist_ok=True)

    decisions = []

    for path in sorted(inbox.glob('*.md')):
        parsed = parse_file(path)
        st = path.stat()
        age_hours = (datetime.now().timestamp() - st.st_mtime) / 3600.0

        reasons = []
        action = 'promote'

        if age_hours > args.sla_hours:
            reasons.append(f'sla_exceeded>{args.sla_hours}h')

        if not re.match(args.require_prefix, path.name):
            reasons.append('prefix_rule_fail')

        if not parsed['has_approval']:
            reasons.append('missing_approval_id')
        if not parsed['has_approval_integrity']:
            reasons.append('approval_integrity_fail')
        if not parsed['has_evidence']:
            reasons.append('missing_evidence')
        if not parsed['has_eval']:
            reasons.append('missing_eval')
        if not parsed['has_learn']:
            reasons.append('missing_learn')

        kpi = parsed['kpi']
        if kpi['success_rate'] is None or kpi['success_rate'] < args.min_success:
            reasons.append('kpi_success_rate_fail')
        if kpi['drift'] is None or kpi['drift'] > args.max_drift:
            reasons.append('kpi_drift_fail')
        if kpi['reproducibility'] is None or kpi['reproducibility'] < args.min_repro:
            reasons.append('kpi_reproducibility_fail')

        if reasons:
            action = 'demote'

        d = Decision(file=str(path), action=action, reasons=reasons, kpi=kpi, age_hours=age_hours)
        decisions.append(d)

        target = applied / path.name if action == 'promote' else demoted / path.name
        if not dry_run:
            shutil.move(str(path), str(target))

        if reasons:
            write_incident(incidents, d, dry_run)

    summary = {
        'time_utc': now_iso(),
        'dry_run': dry_run,
        'counts': {
            'total': len(decisions),
            'promote': sum(1 for d in decisions if d.action == 'promote'),
            'demote': sum(1 for d in decisions if d.action == 'demote'),
        },
        'decisions': [asdict(d) for d in decisions],
    }

    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    out = log_dir / f'pipeline_manager_{"dryrun" if dry_run else "run"}_{stamp}.json'
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print(f'\nlog_file={out}')


if __name__ == '__main__':
    main()
