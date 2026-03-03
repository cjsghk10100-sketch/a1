# TASK-418: Ops Dashboard DB Rate Limit Unification (PR-19)

## Goal
Replace in-memory per-workspace rate limiting in:
- `/v1/system/health/issues`
- `/v1/finance/projection`
with DB-backed `rate_limit_buckets` enforcement using one shared helper.

## Scope
- Add shared helper under `apps/api/src/ratelimit/`
- Wire helper into `system-health.ts` and `finance.ts`
- Keep response contract unchanged (`rate_limited` contract error)
- Remove in-memory maps for these two routes

## Non-goals
- No new deps
- No migrations
- No reason_code changes
- No behavior change outside these routes

## Validation
- `pnpm -C apps/api typecheck`
- `AUTH_ALLOW_LEGACY_WORKSPACE_HEADER=1 NODE_ENV=test DATABASE_URL=postgres://min@/agentapp_contract_test_codex?host=/tmp pnpm -C apps/api exec tsx test/contract_system_health_drilldown.ts`
- `AUTH_ALLOW_LEGACY_WORKSPACE_HEADER=1 NODE_ENV=test DATABASE_URL=postgres://min@/agentapp_contract_test_codex?host=/tmp pnpm -C apps/api exec tsx test/contract_finance_projection.ts`
