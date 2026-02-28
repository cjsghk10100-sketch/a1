#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class Decision:
    file: str
    action: str  # promote|demote|hold
    reasons: list
    warnings: list
    kpi: dict
    age_hours: float


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def post_policy_gate(
    policy_gate_url: str,
    timeout_sec: float,
    workspace_id: str,
    decision: Decision,
) -> dict:
    payload = {
        "workspace_id": workspace_id,
        "file": Path(decision.file).name,
        "requested_action": decision.action,
        "reasons": decision.reasons,
        "warnings": decision.warnings,
        "kpi": decision.kpi,
        "age_hours": decision.age_hours,
    }
    req = urllib.request.Request(
        policy_gate_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "content-type": "application/json",
            "x-workspace-id": workspace_id,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=max(0.1, float(timeout_sec))) as resp:
            if resp.status < 200 or resp.status >= 300:
                raise RuntimeError(f"policy_gate_http_{resp.status}")
            raw = resp.read().decode("utf-8", errors="ignore")
            parsed = json.loads(raw) if raw.strip() else {}
            if not isinstance(parsed, dict):
                raise RuntimeError("policy_gate_invalid_json")
            return parsed
    except urllib.error.URLError as exc:
        raise RuntimeError(f"policy_gate_unreachable:{exc}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"policy_gate_invalid_json:{exc}") from exc


def resolve_gate_action(local_action: str, gate_result: dict) -> str:
    if gate_result.get("allow") is False:
        return "demote"
    gate_action = gate_result.get("action")
    if isinstance(gate_action, str) and gate_action in {"promote", "demote"}:
        return gate_action
    if gate_result.get("allow") is True:
        return local_action
    raise RuntimeError("policy_gate_missing_allow_or_action")


def parse_number(val: str, percent_or_ratio: bool = True):
    v = val.strip().replace('%', '')
    try:
        num = float(v)
    except ValueError:
        return None
    if not percent_or_ratio:
        return num
    if '%' in val:
        return num / 100.0
    if num > 1.0:
        # tolerate 0~100 scale inputs for ratio-like metrics
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

    def pick(key: str, percent_or_ratio: bool = True):
        m = re.search(rf'(?im)^\s*{key}\s*:\s*([^\n]+)', text)
        return parse_number(m.group(1), percent_or_ratio=percent_or_ratio) if m else None

    kpi = {
        'success_rate': pick('success_rate', percent_or_ratio=True),
        'drift': pick('drift', percent_or_ratio=True),
        'reproducibility': pick('reproducibility', percent_or_ratio=True),
        'revenue_usdc': pick('revenue_usdc', percent_or_ratio=False),
        'token_cost_usdc': pick('token_cost_usdc', percent_or_ratio=False),
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
approved_by: owner_min
approved_at: 2026-02-28T00:00:00Z
approval_reason: approved_for_pipeline_pass_sample
EVIDENCE: command logs attached
EVAL: goal met
LEARN: keep this format
success_rate: 95%
drift: 3%
reproducibility: 100%
revenue_usdc: 3.0
token_cost_usdc: 0.5
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
revenue_usdc: 2.0
token_cost_usdc: 1.8
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
    ap.add_argument('--default-revenue-usdc', type=float, default=0.0)
    ap.add_argument('--default-token-cost-usdc', type=float, default=0.0)
    ap.add_argument('--min-margin-rate', type=float, default=0.0, help='Advisory threshold only (warning), 0.0~1.0, e.g., 0.2 means 20%%')
    ap.add_argument('--workspace-id', default=os.getenv('PIPELINE_WORKSPACE_ID', 'ws_dev'))
    ap.add_argument('--policy-gate-url', default=os.getenv('PIPELINE_POLICY_GATE_URL', ''), help='Required for --real-run. App/API gate endpoint for promote/demote approval.')
    ap.add_argument('--policy-gate-timeout-sec', type=float, default=5.0)

    args = ap.parse_args()

    dry_run = True
    if args.real_run and args.confirm_real_run:
        dry_run = False
    elif args.real_run and not args.confirm_real_run:
        print(json.dumps({
            'error': 'real_run_requires_confirm_flag',
            'hint': 'Use both --real-run and --confirm-real-run'
        }, ensure_ascii=False, indent=2))
        sys.exit(2)

    if not dry_run and not str(args.policy_gate_url).strip():
        print(json.dumps({
            'error': 'policy_gate_required_for_real_run',
            'hint': 'Set --policy-gate-url (or PIPELINE_POLICY_GATE_URL) for real-run'
        }, ensure_ascii=False, indent=2))
        sys.exit(2)

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
        warnings = []
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

        revenue = kpi['revenue_usdc'] if kpi['revenue_usdc'] is not None else args.default_revenue_usdc
        token_cost = kpi['token_cost_usdc'] if kpi['token_cost_usdc'] is not None else args.default_token_cost_usdc
        if revenue < 0 or token_cost < 0:
            reasons.append('econ_invalid_negative_values')
            margin_rate = None
        elif revenue == 0:
            margin_rate = None
        else:
            margin_rate = (revenue - token_cost) / revenue
            if margin_rate < args.min_margin_rate:
                warnings.append('kpi_margin_rate_fail')

        kpi['revenue_usdc'] = revenue
        kpi['token_cost_usdc'] = token_cost
        kpi['margin_rate'] = margin_rate

        if reasons:
            action = 'demote'

        decisions.append(
            Decision(file=str(path), action=action, reasons=reasons, warnings=warnings, kpi=kpi, age_hours=age_hours)
        )

    if not dry_run:
        for d in decisions:
            try:
                gate_result = post_policy_gate(
                    policy_gate_url=str(args.policy_gate_url).strip(),
                    timeout_sec=args.policy_gate_timeout_sec,
                    workspace_id=str(args.workspace_id).strip() or "ws_dev",
                    decision=d,
                )
                gated_action = resolve_gate_action(d.action, gate_result)
                if gated_action != d.action:
                    d.warnings.append("policy_gate_action_override")
                    d.action = gated_action
            except Exception as exc:
                print(json.dumps({
                    "error": "policy_gate_blocked_transition",
                    "file": Path(d.file).name,
                    "requested_action": d.action,
                    "reason": str(exc),
                }, ensure_ascii=False, indent=2))
                sys.exit(3)

    for d in decisions:
        target = applied / Path(d.file).name if d.action == 'promote' else demoted / Path(d.file).name
        if not dry_run:
            shutil.move(d.file, str(target))
        if d.reasons:
            write_incident(incidents, d, dry_run)

    margins = [d.kpi.get('margin_rate') for d in decisions if d.kpi.get('margin_rate') is not None]
    total_revenue = sum((d.kpi.get('revenue_usdc') or 0.0) for d in decisions)
    total_token_cost = sum((d.kpi.get('token_cost_usdc') or 0.0) for d in decisions)
    total_net_margin = total_revenue - total_token_cost

    summary = {
        'time_utc': now_iso(),
        'dry_run': dry_run,
        'counts': {
            'total': len(decisions),
            'promote': sum(1 for d in decisions if d.action == 'promote'),
            'demote': sum(1 for d in decisions if d.action == 'demote'),
            'warn': sum(1 for d in decisions if len(d.warnings) > 0),
        },
        'economics': {
            'total_revenue_usdc': total_revenue,
            'total_token_cost_usdc': total_token_cost,
            'total_net_margin_usdc': total_net_margin,
            'avg_margin_rate': (sum(margins) / len(margins)) if margins else None,
            'min_margin_rate_advisory': args.min_margin_rate,
        },
        'margin_warnings': {
            'count': sum(1 for d in decisions if 'kpi_margin_rate_fail' in d.warnings),
            'files': [Path(d.file).name for d in decisions if 'kpi_margin_rate_fail' in d.warnings],
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
