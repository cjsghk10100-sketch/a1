# TASK-213: Agent Profile Constraint/Mistake Links -> Event-focused Inspector

## 1) Problem
Constraint/mistake rows currently navigate by `run_id` only. Operators still need to find the exact event inside the run event list.

## 2) Scope
In scope:
- Use event-focused deep links for constraint/mistake rows.
- Keep `run_id` in query when available so Inspector loads run context and focuses the event.

Out of scope:
- API/DB changes.
- Assessment row behavior changes.

## 3) Constraints (Security/Policy/Cost)
- UI-only observability enhancement.
- No new dependencies.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- New files to add:
  - none

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Agent Profile > Constraints/Mistakes click Inspector button.
  2. Inspector opens with `event_id` and (if available) `run_id`.
  3. Event detail opens directly for clicked row.

## 6) Step-by-step plan
1. Switch constraints/mistakes buttons to event-focused navigation helper.
2. Keep assessment links run-focused.
3. Validate by typecheck + contracts.

## 7) Risks & mitigations
- Risk: labels become misleading.
- Mitigation: use event-specific button label for constraints/mistakes.

## 8) Rollback plan
Revert AgentProfile link calls back to run-only behavior.
