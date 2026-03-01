# TASK-410 — System Health Drilldown v0.1

## Scope
- Add read-only drilldown endpoint for PR-10 top issue kinds.
- Keep `/v1/system/health` backward compatible.
- Add bounded indexes for drilldown pagination queries.

## Execution
1. Add `GET /v1/system/health/issues` with strict workspace isolation and auth parity.
2. Reuse health issue kind constants from existing system-health route.
3. Implement composite cursor pagination (`updated_at`, `entity_id`) with deterministic ordering.
4. Add migration for drilldown indexes guarded by `IF EXISTS`.
5. Add contract test coverage for validation, isolation, pagination, and cursor safety.
6. Update docs and kernel protocol log for migration + route changes.

## Verification
- `pnpm -C apps/api typecheck`
- `DATABASE_URL=... NODE_ENV=test pnpm -C apps/api exec tsx test/contract_system_health_drilldown.ts`
- `DATABASE_URL=... pnpm -C apps/api test`
