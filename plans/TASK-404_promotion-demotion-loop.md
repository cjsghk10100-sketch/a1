# TASK-404: Promotion/Demotion loop (Score outcome -> recommendation/incident/revoke request)

## 1) Problem
Trust/autonomy/incidents/quarantine primitives exist, but score outcomes are not wired into a closed governance loop.

## 2) Scope
In scope:
- loop evaluation on each `scorecard.recorded`
- PASS path:
  - threshold reached -> recommendation path (`autonomy.upgrade.recommended`) only
  - never auto-approve
- FAIL/drift path:
  - open incident for loop failure context
  - severe case may create revoke approval request (`approval.requested` with capability revoke action)
  - quarantine only on severe repeated failure
- optional observability event: `promotion.evaluated`
- optional diagnostics endpoint:
  - `GET /v1/agents/:agentId/promotion-loop/status`
- contract test `apps/api/test/contract_promotion_loop.ts`

Out of scope:
- auto grant/revoke without approval boundary
- UI implementation

## 3) Constraints
- Request != Execute must remain intact
- no breaking existing trust APIs
- missing `agent_id` on scorecard must not fail scorecard write; loop is skipped with reason

## 4) Default thresholds
- PASS: >= 3 pass in trailing 7d and fail ratio below guard
- FAIL: >= 3 fail in trailing 7d or drift/severity threshold
- dedupe:
  - no duplicate pending recommendation
  - no duplicate open loop-incident

## 5) Acceptance
- PASS generates pending recommendation only
- FAIL generates incident; severe branch creates revoke-approval request
- no direct capability grant/revoke bypass
- contract tests pass

## 6) Risks
- noisy recommendation/incident churn:
  - mitigated by dedupe and hysteresis
- over-aggressive demotion:
  - severe branch defaults to incident + approval request before hard actions

## 7) Rollback
- disable by env flag `PROMOTION_LOOP_ENABLED=0`
- revert PR; no kernel rewrite needed
