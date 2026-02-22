# TASK-265: Web Agent Profile Trust Recalculate Action

## Summary
Wire the new `POST /v1/agents/:agentId/trust/recalculate` endpoint into Agent Profile so operators can refresh trust from live signals without leaving the UI.

## Scope
- Add web API helper for trust recalculate.
- Add Agent Profile action button in Trust section.
- Call recalculate with operator actor/principal context for auditability.
- Refresh dependent panels (approval recommendation + change timeline) after recalc.
- Add EN/KO i18n labels for recalc action/loading.

Out of scope:
- API/DB/event schema changes.
- Trust formula changes.
- New dashboard widgets.

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual:
  1. Open `/agent`.
  2. Select an agent.
  3. Click trust recalculate button.
  4. Confirm trust row refreshes and change timeline includes trust event when score changes.
