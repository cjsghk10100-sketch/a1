# TASK-210: Agent Profile Assessment Risk Signals for Approval Recommendation

## 1) Problem
Approval recommendation now considers assessment regression risk in API, but Agent Profile does not explicitly show the underlying assessment risk metrics near recommendation rows. Operators cannot quickly verify why recommendations became stricter.

## 2) Scope
In scope:
- Add assessment risk signal summary block in Agent Profile Permissions tab under Approval recommendation.
- Surface assessment metrics from recommendation context when available.
- Add fallback metric derivation from recent assessment list when recommendation context is unavailable.
- Add EN/KO i18n keys for the new signal labels.

Out of scope:
- Backend/API logic changes.
- DB schema changes.
- New pages.

## 3) Constraints (Security/Policy/Cost)
- Read-only UI observability only.
- No secret exposure.
- Keep rendering bounded and lightweight.

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
  1. Agent Profile > Permissions > Approval recommendation shows assessment signal values.
  2. Elevated assessment regression displays warning-like pill.

## 6) Step-by-step plan
1. Add derived assessment signal memo in AgentProfile page.
2. Connect recommendation context metrics when available.
3. Render signal block below approval recommendation matrix.
4. Add EN/KO i18n keys.
5. Run typecheck and contract tests.

## 7) Risks & mitigations
- Risk: API context fields absent in older data.
- Mitigation: fallback derivation + null-safe rendering.

## 8) Rollback plan
Revert AgentProfile and i18n file changes to remove the new signal block.
