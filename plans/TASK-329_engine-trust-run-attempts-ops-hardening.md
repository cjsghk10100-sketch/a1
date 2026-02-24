# TASK-329: Engine Trust Boundary + Run Attempts + Ops Hardening

## Summary
Implement the next hardening layer after TASK-328:

1. Engine trust boundary (register/deactivate + engine token + capability binding)
2. Run execution guarantee model (`run_attempts`)
3. Ops safeguards (secret key rotation path, hash-chain verification batch, backup/recovery runbook)
4. Minimal Ops UI surface (runtime/runner, lease expiry risk, quarantine status)

## Scope
In scope:
- API:
  - `v1/engines` registration/deactivation/token issue/revoke/list
  - enforce engine token validation on:
    - `POST /v1/runs/claim`
    - `POST /v1/runs/:runId/lease/heartbeat`
    - `POST /v1/runs/:runId/lease/release`
  - `run_attempts` table and claim/release tracking
- Engine:
  - support engine token headers for API calls
  - auto bootstrap registration when token is missing
- Ops safeguards:
  - secrets rotation script
  - hash-chain verification batch script
  - backup/recovery runbook document
- Web:
  - minimal Ops page to show runtime + lease risk + quarantined agents

Out of scope:
- Rewriting existing policy model
- Replacing Postgres backup strategy
- Full role-based management UI

## Acceptance
- `pnpm -r typecheck`
- `pnpm -C apps/web test`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- manual:
  - external engine can still process runs with engine token flow
  - invalid/missing engine token is rejected on claim/heartbeat/release
  - run attempts are recorded and released with reason
