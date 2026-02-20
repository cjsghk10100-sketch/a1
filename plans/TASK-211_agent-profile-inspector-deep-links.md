# TASK-211: Agent Profile -> Inspector Deep Links

## 1) Problem
Agent Profile shows assessments/constraints/mistakes/change timeline, but operators cannot jump directly to Inspector context for the same run or event. Investigation requires manual copy/paste of run IDs.

## 2) Scope
In scope:
- Add Inspector deep-link actions in Agent Profile rows:
  - assessment row (by run_id when available),
  - constraint/mistake rows (by run_id when available),
  - change timeline row (by event_id).
- Keep links in-app via router navigation.
- Add EN/KO i18n keys for button labels.

Out of scope:
- API/DB changes.
- Inspector behavior changes.

## 3) Constraints (Security/Policy/Cost)
- UI-only observability enhancement.
- No secrets or additional payload exposure.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- New files to add:
  - none

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Agent Profile assessment row button opens Inspector with run context.
  2. Change timeline row button opens Inspector event detail.

## 6) Step-by-step plan
1. Add `useNavigate` in Agent Profile.
2. Add small action buttons in target rows.
3. Add EN/KO i18n keys.
4. Run typecheck and API contracts.

## 7) Risks & mitigations
- Risk: missing run_id/event_id on some rows.
- Mitigation: render button only when target ID exists.

## 8) Rollback plan
Revert AgentProfile and i18n changes to remove deep links.
