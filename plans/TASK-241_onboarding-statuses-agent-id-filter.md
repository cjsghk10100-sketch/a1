# TASK-241: Onboarding Statuses Batch Filter by Agent IDs

## 1) Problem
The batch onboarding status endpoint currently returns the most recently created agents with a `limit`. In UI contexts that already have a concrete agent list, this can miss older agents and show stale/empty indicator counts.

## 2) Scope
In scope:
- Add optional `agent_ids` filter support to `GET /v1/agents/skills/onboarding-statuses`.
- Keep existing `limit` + `only_with_work` behavior for backward compatibility.
- Update web helper/page to request statuses for the exact loaded agents.
- Add API contract assertions for `agent_ids` filtering behavior.

Out of scope:
- DB schema or migration changes.
- Changes to single-agent onboarding status endpoint.

## 3) Constraints (Security/Policy/Cost)
- Workspace scoping remains mandatory.
- Read-only aggregation only.
- Cheap-by-default: fetch only what UI needs.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-241_onboarding-statuses-agent-id-filter.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Web agent onboarding indicators are populated from filtered batch request based on current agent list.

## 6) Step-by-step plan
1. Add query parser for `agent_ids` and validate/normalize IDs.
2. Update SQL for batch endpoint to scope by explicit IDs when provided.
3. Add contract assertions for `agent_ids` filter results.
4. Add web helper support for `agent_ids` and update page call site.
5. Run typecheck + full contracts.

## 7) Risks & mitigations
- Risk: Invalid IDs in query can cause SQL mismatch.
  - Mitigation: normalize to unique non-empty strings and ignore invalid entries.
- Risk: Long query strings if many IDs.
  - Mitigation: chunk requests on web side.

## 8) Rollback plan
Revert this commit to restore `limit`-only behavior.
