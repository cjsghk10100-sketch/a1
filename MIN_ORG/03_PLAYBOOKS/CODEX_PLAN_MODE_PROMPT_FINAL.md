# CODEX_PLAN_MODE_PROMPT_FINAL

아래 프롬프트를 Codex에 그대로 전달한다.

---
You are redesigning an agent OS app. Use PLAN MODE.
Do NOT write code until I approve the plan.

Goal:
- Build a self-improving agent organization loop:
  Goal→Portfolio→Approval→Execute→Evidence→Eval→Learn→Promote (with demotion path).
- Keep existing OS kernel intact: event sourcing + projections + policy gate + approvals + runs/steps/toolcalls/artifacts.

Non-goals:
- No full rewrite (no framework swap, no DB swap).
- No breaking changes to core event semantics unless absolutely necessary.

Kernel invariants (must preserve):
- Append-only event integrity
- Request≠Execute boundary
- Evidence-required completion
- Risk-based approvals
- Least privilege + pre-persist secret redaction

Required plan deliverables:
1) Current architecture map
   - events, projections, approval/execution/evidence mapping
2) Minimal additions for:
   - Evidence Bundle Manifest (Run→Evidence bundle 1:1)
   - Experiment (1:N runs)
   - Scorecard (standard metrics + calc responsibility)
   - Promotion/Demotion pipeline (pass/fail → scoped autonomy change with approvals)
3) Migration plan
   - exact steps, backfill strategy, compatibility notes
4) Test plan
   - invariants, replay tests, security checks
5) PR breakdown
   - 3~5 PRs, each with Definition of Done

Constraints:
- Maintain append-only integrity.
- Keep risk-based approval enforced.
- Every new table/event must have explicit write/read path.
- Avoid unused/placeholder schema.

Output format:
- Numbered plan with headings
- Exact tables/events to add
- Edge cases + rollback strategy
- Risk register per PR
---
