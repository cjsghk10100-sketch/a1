# TASK-236: Onboarding Status Summary API + Web Visibility

## 1) Problem
Onboarding state (verified/pending/quarantined, assessed/unassessed) is spread across multiple calls and inferred in UI.
A compact summary endpoint improves operational clarity and reduces manual counting.

## 2) Scope
In scope:
- Add API endpoint `GET /v1/agents/:agentId/skills/onboarding-status`.
- Add shared response type and web API helper.
- Show summary block in onboarding section.
- Add contract test assertions for the endpoint.

Out of scope:
- DB migrations
- New events

## 3) Constraints (Security/Policy/Cost)
- Read-only endpoint; no state mutation.
- Scope by `workspace_id` + `agent_id`.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-236_onboarding-status-summary-api-and-web.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Agent profile onboarding shows live summary from API.

## 6) Step-by-step plan
1. Add shared type for onboarding summary response.
2. Implement API endpoint with aggregation queries.
3. Add web helper.
4. Load/render summary in onboarding section with refresh action.
5. Extend onboarding contract test to validate summary values.
6. Run typecheck + full contracts.

## 7) Risks & mitigations
- Risk: mismatch between linked package states and assessed skill rows.
  - Mitigation: compute assessed/unassessed from verified linked skill set only.

## 8) Rollback plan
Revert endpoint/helper/UI/test and this plan file.
