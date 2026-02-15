# TASK-120: Progressive Trust Score + Autonomy Upgrade Flow (recommend -> approve)

## Dependencies
- TASK-103 capability tokens (upgrade target)
- TASK-104 policy gate v2 (to consume trust later)

## 1) Problem
We can observe actions today, but we cannot see or evolve “agent autonomy” safely.
We need:
- a trust score computed from observable signals
- an explicit flow: system recommends autonomy upgrade; user approves once

## 2) Scope
In scope:
- DB:
  - `sec_agent_trust` table (current score + components)
  - `sec_autonomy_recommendations` table (recommended scope delta + rationale)
- Events:
  - `agent.trust.increased` / `agent.trust.decreased`
  - `autonomy.upgrade.recommended`
  - `autonomy.upgrade.approved`
- API:
  - `GET /v1/agents/:id/trust`
  - `POST /v1/agents/:id/autonomy/recommend`
  - `POST /v1/agents/:id/autonomy/approve` (applies a capability token change)

Out of scope:
- Full eval harness (TASK-121).
- Automatic upgrades without approval.

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**: trust score exists but is not required to use existing endpoints.
- Recommendation/approval must be auditable (events + stored deltas).

## 4) Repository context
New files:
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/migrations/020_trust_scores.sql`
- `/Users/min/Downloads/에ᄋᵍᅦ이전트 앱/apps/api/src/routes/v1/trust.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Trust can be read and recommendations/approvals produce events

## 6) Step-by-step plan
1. Define minimal trust model and scoring function (static weights).
2. Add migrations for trust tables.
3. Implement API routes (recommend/approve/read).
4. Emit events and ensure idempotency.
5. Add contract tests for recommend->approve lifecycle.

## 7) Risks & mitigations
- Risk: Early trust scoring is wrong.
  - Mitigation: store components; allow recalculation; don’t auto-upgrade.

## 8) Rollback plan
Revert PR. Tables can remain unused.

