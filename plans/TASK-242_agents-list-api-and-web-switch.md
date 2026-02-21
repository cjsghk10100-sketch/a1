# TASK-242: Agents List API + Web Switch from Event Scan

## 1) Problem
The web currently discovers agents by scanning `agent.registered` events, which can become incomplete/stale with fixed event limits and unnecessary event payload processing.

## 2) Scope
In scope:
- Add `GET /v1/agents?limit=` API endpoint returning recent agents.
- Add shared response type for the list endpoint.
- Switch web `listRegisteredAgents()` to use the new endpoint directly.
- Add contract assertion for list endpoint behavior.

Out of scope:
- Any DB schema change.
- Pagination cursor design (limit-only for now).

## 3) Constraints (Security/Policy/Cost)
- Read-only endpoint.
- Keep workspace-neutral semantics consistent with existing `sec_agents` access.
- Cheap-by-default query with bounded limit.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-242_agents-list-api-and-web-switch.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Web agent selector loads agents through `GET /v1/agents` path.

## 6) Step-by-step plan
1. Add list response type in shared package.
2. Implement `GET /v1/agents` endpoint in API route.
3. Add contract test assertions for list endpoint.
4. Update web helper to call list endpoint and remove event-scan parsing.
5. Run typecheck + full contracts.

## 7) Risks & mitigations
- Risk: Ordering mismatch with previous event-based list.
  - Mitigation: sort by `created_at DESC` in API.
- Risk: behavior drift if list includes revoked/quarantined agents.
  - Mitigation: keep fields explicit so UI can filter later if needed.

## 8) Rollback plan
Revert this commit to restore event-scan based list loading.
