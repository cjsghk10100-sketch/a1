# TASK-231: Onboarding Certify Imported Endpoint (Review + Assess)

## 1) Problem
First-auth onboarding currently needs two API calls (`review-pending` then `assess-imported`).
This increases orchestration complexity and can introduce timing/race mismatches for automation clients.

## 2) Scope
In scope:
- Add API endpoint to run pending review and imported assessment in one request.
- Add shared request/response types.
- Add web API helper.
- Extend onboarding contract test coverage for this endpoint.

Out of scope:
- DB migrations
- New event types
- Replacing existing endpoints

## 3) Constraints (Security/Policy/Cost)
- Reuse existing review/assess endpoint behavior (no policy bypass).
- Preserve actor/principal metadata across both phases.
- Keep assessment bounded via `limit` and `only_unassessed`.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-231_onboarding-certify-imported-endpoint.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- `POST /v1/agents/:agentId/skills/certify-imported` returns both review and assess summaries.

## 6) Step-by-step plan
1. Add shared request/response interfaces for certify endpoint.
2. Implement API endpoint that orchestrates internal calls to existing `review-pending` and `assess-imported`.
3. Add web API helper.
4. Extend contract onboarding test with certify-imported scenario.
5. Run typecheck + full API contracts.

## 7) Risks & mitigations
- Risk: behavior drift from existing endpoints.
  - Mitigation: route reuses existing endpoint execution path via internal dispatch.
- Risk: actor principal mismatch between review and assess payload shapes.
  - Mitigation: map both (`principal_id` and `actor_principal_id`) from one input body.

## 8) Rollback plan
Revert endpoint/helper/type/test changes and this plan file.
