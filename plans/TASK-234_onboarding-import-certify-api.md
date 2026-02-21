# TASK-234: Onboarding Import-Certify API (One Request)

## 1) Problem
When both auto-verify and auto-assess are enabled, the web flow still does `import` then `certify-imported` as two API calls.
This keeps client-side orchestration complexity and leaves a small timing window between phases.

## 2) Scope
In scope:
- Add API endpoint `POST /v1/agents/:agentId/skills/import-certify`.
- Endpoint orchestrates existing `skills/import` + `skills/certify-imported` in one server request.
- Add shared request/response types and web API helper.
- Update onboarding UI to use the new endpoint when both auto toggles are ON.
- Extend contract onboarding test for endpoint behavior.

Out of scope:
- DB migrations
- New event types
- Removing existing endpoints

## 3) Constraints (Security/Policy/Cost)
- Reuse existing import/certify routes to preserve policy/event behavior.
- Preserve actor/principal and correlation metadata.
- Keep assessment bounded (`limit`, `only_unassessed`).

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-234_onboarding-import-certify-api.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- When both onboarding auto toggles are ON, web uses `import-certify` path.

## 6) Step-by-step plan
1. Add shared request/response interfaces for import-certify.
2. Implement API route via internal `app.inject` chaining import + certify.
3. Add web API helper.
4. Update web onboarding import branch to call one endpoint and map results to existing state.
5. Extend onboarding contract test with import-certify scenario.
6. Run typecheck and full contracts.

## 7) Risks & mitigations
- Risk: Response shape drift with nested objects.
  - Mitigation: reuse existing response interfaces directly in composed response.
- Risk: UI state mismatches after endpoint switch.
  - Mitigation: map server summaries into existing `skillImportResult`, verify progress/errors, assess summary.

## 8) Rollback plan
Revert API/helper/UI/test changes and this plan file.
