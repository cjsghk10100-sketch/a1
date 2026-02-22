# TASK-263: Trust Policy Violation Signal Hardening (Blocked-Only + Burst Compression)

## 1) Problem
`policy_violations_7d` currently counts raw violation event volume for an actor principal.
This over-penalizes trust in two common cases:
- Shadow-mode policy/egress events (`blocked=false`) are counted like real violations.
- Repeated identical violations in a short burst are counted one-by-one.

Result: trust score can drop from noisy signals rather than meaningful risk.

## 2) Scope
In scope:
- API trust default signal calculation (`/v1/agents/:agentId/trust`, `/autonomy/recommend` path) for `policy_violations_7d`
- Count only blocked violations (or legacy events without blocked field)
- Compress repeated identical violations into hourly buckets
- Exclude system-state reasons that should not reduce trust (`agent_quarantined`, `kill_switch_active`)
- Contract test coverage update

Out of scope:
- DB schema changes
- UI changes
- Policy decision engine rules themselves

## 3) Constraints (Security/Policy/Cost)
- Keep audit/event data unchanged (append-only).
- Do not reduce enforcement behavior; only improve trust scoring signal quality.
- Keep implementation cheap (single SQL aggregation query).

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/trust.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_trust.ts`
- New files:
  - none

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes
- Contract behavior:
  - shadow-mode egress blocked events do not increase `policy_violations_7d`
  - enforce-mode repeated same violation burst is compressed (hourly)

## 6) Step-by-step plan
1. Update trust violation aggregation query in `trust.ts` to:
   - filter to blocked=true (or missing blocked key for compatibility)
   - exclude `agent_quarantined` and `kill_switch_active`
   - count distinct `(event_type, reason_code, action, hour_bucket)`
2. Extend `contract_trust.ts` with an end-to-end scenario validating shadow exclusion + burst compression.
3. Run typecheck + full API contract tests.

## 7) Risks & mitigations
- Risk: Over-filtering can undercount true risk.
- Mitigation: keep backward compatibility for legacy events (missing `blocked` treated as blocked), and scope exclusion to clearly system-level reasons only.

## 8) Rollback plan
- Revert changes in `trust.ts` and `contract_trust.ts`.
- Re-run contracts to verify previous behavior restored.
