# TASK-427: Stage B Cutover Rehearsal (fallback OFF -> rollback ON)

## 1) Problem
- Stage A baseline (`ENGINE_INGEST_LEGACY_FALLBACK=1`) is validated, but Stage B cutover readiness is not proven with fresh, reproducible evidence.
- Operators need explicit proof that fallback-OFF path is stable and rollback-ON path is immediately recoverable.

## 2) Scope
In scope:
- Re-run release gates with `ENGINE_INGEST_LEGACY_FALLBACK=0` (Stage B rehearsal).
- Re-run rollback path with `ENGINE_INGEST_LEGACY_FALLBACK=1`.
- Record command outputs and evidence paths in docs.

Out of scope:
- API/schema/event/reason_code changes.
- New runtime features.
- Dependency changes.

## 3) Acceptance
1. Stage B (`fallback=0`) commands PASS:
   - a1 smoke/live-probe
   - a2 quality gate + quick/full E2E
2. Rollback rehearsal (`fallback=1`) quick/full E2E PASS in same session.
3. Evidence files and log bundle are documented in release docs/matrix.

## 4) Commands
- `ENGINE_INGEST_TRANSPORT=evidence ENGINE_INGEST_LEGACY_FALLBACK=0 ...`
- `ENGINE_INGEST_TRANSPORT=evidence ENGINE_INGEST_LEGACY_FALLBACK=1 ...`

## 5) Rollback
- Docs-only revert if needed.
- Runtime rollback switch remains:
  - `ENGINE_INGEST_TRANSPORT=evidence`
  - `ENGINE_INGEST_LEGACY_FALLBACK=1`
