# TASK-207: Agent Growth Percent KPIs (7d vs previous 7d)

## 1) Problem
Growth tab currently shows absolute deltas (trust/autonomy), but not percentage growth against a previous baseline window.
Operators asked for date-based growth percentage visibility.

## 2) Scope
In scope:
- Compute growth percentages from existing snapshot rows:
  - trust growth %: average(last 7 snapshots) vs average(previous 7 snapshots)
  - autonomy growth %: same
- Render these values in Growth UI with trend pills.
- Add EN/KO i18n labels.

Out of scope:
- API changes.
- Snapshot generation logic changes.

## 3) Constraints (Security/Policy/Cost)
- Read-only UI calculation.
- No additional network calls.

## 4) Repository context
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Agent with >=14 snapshots shows trust/autonomy growth % values.
  2. Insufficient snapshots shows fallback (`—`).

## 6) Step-by-step plan
1. Add helper calculations for window averages and growth percent.
2. Add UI rows/cards for trust/autonomy growth percentages.
3. Add i18n keys (EN/KO).
4. Run typecheck + contracts.

## 7) Risks & mitigations
- Risk: Division-by-zero when baseline is near zero.
- Mitigation: return null for near-zero baseline and render `—`.

## 8) Rollback plan
Revert the two files above to remove computed growth% fields and labels.
