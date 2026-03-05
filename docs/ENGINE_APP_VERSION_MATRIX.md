# Engine-App Version Matrix (a1 ↔ eg1)

As of 2026-03-05, use this compatibility baseline for local and staging integration.

## Baseline Pair

| Component | Repo | Reference |
| --- | --- | --- |
| App/API | `a1` | `origin/main@1a9f6d5` |
| External engine | `eg1` | `origin/main@bd21610` |

## Required Interface Contract

- App side must expose `POST /v1/engines/evidence/ingest`.
- Engine default transport is evidence ingest.
- Engine may fallback to `/v1/messages` only when configured (`ENGINE_INGEST_LEGACY_FALLBACK=1`).
- Non-2xx `/v1/messages` status must be propagated to caller (retry/auth handling).

## Local Smoke Checklist

1. App health reachable: `GET /health` returns 200.
2. Engine ingest path reachable: `POST /v1/engines/evidence/ingest` contract test green.
3. Engine bridge tests green:
   - evidence accepted/deduped
   - evidence non-200 + legacy fallback
   - messages non-2xx propagation

## Rollback Guidance

- Immediate rollback switch:
  - `ENGINE_INGEST_TRANSPORT=messages`
- Keep app endpoint unchanged; only transport routing is switched in engine.
