# TASK-411 — Finance Projection Read API v0 (PR-12A)

## Scope
- Add projection-only `POST /v1/finance/projection` for dashboard finance trend read.
- Reuse existing read-safe patterns (read-only tx, statement timeout, cache/singleflight/circuit-breaker, live DB server_time).
- Use existing projection table only: `sec_survival_ledger_daily` (`snapshot_date`, `estimated_cost_units`).
- Preserve existing contracts and reason code mapping; no schema/event/projector changes.

## Execution
1. Add new route module `apps/api/src/routes/v1/finance.ts` with:
   - schema/version validation and workspace/auth parity with existing v1 read routes.
   - days_back parse/validation/clamp.
   - read-only metrics query with UTC day gap-fill and workspace isolation.
   - ping splitting, per-entry TTL cache, bounded cache, singleflight, circuit-breaker fallback.
2. Mount finance route in `apps/api/src/routes/v1/index.ts`.
3. Add contract test `apps/api/test/contract_finance_projection.ts` with source-present/source-missing tolerant assertions and cache hygiene via `clearFinanceCache()`.
4. Append finance contract test to `apps/api/package.json` test chain.
5. Add doc `docs/FINANCE_PROJECTION_v0.md` with contract, data source, caching, and safety notes.

## Verification
- `pnpm -C apps/api typecheck`
- `AUTH_ALLOW_LEGACY_WORKSPACE_HEADER=1 DATABASE_URL=... NODE_ENV=test pnpm -C apps/api exec tsx test/contract_finance_projection.ts`
- `AUTH_ALLOW_LEGACY_WORKSPACE_HEADER=1 DATABASE_URL=... NODE_ENV=test pnpm -C apps/api test`
