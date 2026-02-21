# TASK-240: Batch Onboarding Statuses API + Web Adoption

## 1) Problem
Agent selector onboarding indicators currently trigger many per-agent requests. This increases API load and slows refresh as agent count grows.

## 2) Scope
In scope:
- Add batch endpoint `GET /v1/agents/skills/onboarding-statuses`.
- Add shared types + web helper for the batch response.
- Update AgentProfile web list indicator logic to use one batch request.
- Add contract assertions for batch endpoint behavior.

Out of scope:
- DB migrations
- Event changes
- Policy behavior changes

## 3) Constraints (Security/Policy/Cost)
- Read-only aggregation scoped by `workspace_id`.
- Cheap-by-default: replace N calls with one call.
- Keep existing single-agent endpoint for compatibility.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-240_batch-onboarding-statuses-api-and-web.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Agent list onboarding indicators are loaded through batch API call path.

## 6) Step-by-step plan
1. Add shared summary/list response types for onboarding status batch.
2. Implement API endpoint with grouped SQL aggregations.
3. Add API contract assertions for list endpoint.
4. Add web helper and switch agent indicator loading to batch call.
5. Run typecheck and full contracts.

## 7) Risks & mitigations
- Risk: Aggregation query mismatch with single-status semantics.
  - Mitigation: Reuse the same summary field definitions and verify in contract tests.
- Risk: Large response size with many agents.
  - Mitigation: support `limit` and `only_with_work` query params.

## 8) Rollback plan
Revert endpoint/helper/UI changes and this plan file.
