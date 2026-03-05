# Engine-App Version Matrix (a1 ↔ eg1)

As of 2026-03-05, use this compatibility baseline for local and staging integration.

## Baseline Pair (2026-03-05)

| Component | Repo | Reference |
| --- | --- | --- |
| App/API | `a1` | `origin/main@3a60217` |
| External engine | `eg1` | `origin/main@6179c21` |

## Required Interface Contract

- App side must expose `POST /v1/engines/evidence/ingest`.
- Engine default transport is evidence ingest.
- Engine may fallback to `/v1/messages` only when configured (`ENGINE_INGEST_LEGACY_FALLBACK=1`).
- Non-2xx `/v1/messages` status must be propagated to caller (retry/auth handling).

## Local Smoke Checklist

1. Run unified smoke script:
   - `bash ./scripts/e2e_engine_app_smoke.sh`
2. Expected:
   - engine ingest tests pass
   - app evidence-ingest contract passes
   - ops-dashboard typecheck/tests pass

## Rollback Guidance

- Immediate rollback switch:
  - `ENGINE_INGEST_TRANSPORT=messages`
- Keep app endpoint unchanged; only transport routing is switched in engine.
- If dashboard bootstrap behavior regresses, rollback app side only by reverting the `ops-dashboard` commit and keep API/engine as-is.
