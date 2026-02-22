# TASK-264: Trust Recalculate Endpoint (Event-Derived Refresh)

## 1) Problem
`sec_agent_trust` is persisted and can become stale between recommendation updates.
Operators need a deterministic way to refresh trust from current event signals without issuing an autonomy recommendation.

## 2) Scope
In scope:
- Add API endpoint: `POST /v1/agents/:agentId/trust/recalculate`
- Recompute trust using existing default signal loader (`loadSignalDefaults`) and persist row
- Emit `agent.trust.increased` / `agent.trust.decreased` when score changes
- Return refreshed trust payload
- Add contract test coverage

Out of scope:
- UI wiring/buttons
- DB schema changes
- Recommendation logic changes

## 3) Constraints (Security/Policy/Cost)
- Append-only event integrity unchanged
- No policy bypass; endpoint only recalculates derived trust state
- Keep implementation cheap-by-default (existing queries + one update)

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/trust.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_trust.ts`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/trust.ts`
- New files:
  - none

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- `pnpm lint` passes
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes
- Contract verifies:
  - endpoint exists and returns refreshed trust row
  - event-derived violations are reflected after recalc

## 6) Step-by-step plan
1. Add shared request/response interfaces for trust recalc endpoint.
2. Implement endpoint in `trust.ts`:
   - validate agent
   - load current trust and default signals
   - compute new score, persist row, emit trust change event when delta exceeds epsilon
   - return refreshed trust object
3. Extend `contract_trust.ts` to call recalc after creating violation events and assert refreshed fields.
4. Run lint/typecheck/full contracts.

## 7) Risks & mitigations
- Risk: Endpoint semantics overlap with autonomy recommendation side effects.
- Mitigation: recalc endpoint updates trust only; does not write autonomy recommendation records.

## 8) Rollback plan
- Revert changes in trust route/shared types/contract test.
- Re-run contracts to confirm old behavior restored.
