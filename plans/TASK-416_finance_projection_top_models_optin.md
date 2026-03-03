# TASK-416 — PR-16 Finance Projection v0 Opt-in `include=["top_models"]`

## Scope
- Add additive opt-in include parser to `POST /v1/finance/projection`.
- Keep baseline response contract unchanged when include is absent or no known includes are applied.
- Add include-aware cache/singleflight keys.
- Add optional `top_models` query path guarded by SAVEPOINT so partial failure does not abort tx.
- If model dimension unsupported, return empty list + warning (no 500).

## Non-goals
- No new endpoint / no new event / no projector change / no migration unless absolutely needed.
- No reason_code/schema_version changes.

## Implementation steps
1. Extend route input parsing:
   - `include` validation: array only, <=10, string elements only.
   - Allowlist: `top_models` only, unknown ignored.
   - deterministic applied include list (dedupe + sort).
2. Keep baseline response shape exactly as-is when include is absent/empty.
3. For include path:
   - Use include-aware cache key and singleflight key.
   - Reuse baseline metrics compute logic.
   - Query top models only if model dimension exists; otherwise warning `top_models_unsupported`.
   - SAVEPOINT around optional top-model query; on error, rollback to savepoint and return baseline + warning.
4. Extend contract tests:
   - baseline unchanged, unknown include ignored, include validation errors,
   - cache key separation, deterministic ordering, string numeric fields.
5. Update docs `docs/FINANCE_PROJECTION_v0.md` with opt-in section.

## Acceptance checks
- `pnpm -C apps/api typecheck`
- `AUTH_ALLOW_LEGACY_WORKSPACE_HEADER=1 NODE_ENV=test DATABASE_URL=... pnpm -C apps/api exec tsx test/contract_finance_projection.ts`
