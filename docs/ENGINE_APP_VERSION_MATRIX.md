# Engine-App Version Matrix (a1 ↔ eg1)

As of 2026-03-06, use this compatibility baseline for local and staging integration.

## Baseline Pair (2026-03-06)

| Component | Repo | Reference |
| --- | --- | --- |
| App/API | `a1` | `origin/main@10030bd` |
| External engine | `eg1` | `origin/main@37d7c85` |

Note:
- `a1` tip `fb94271` is docs-only closeout; runtime validation baseline remains `10030bd`.
- `eg1` tip `37d7c85` adds Stage B rehearsal evidence only (no runtime contract change).

## Required Interface Contract

- App side must expose `POST /v1/engines/evidence/ingest`.
- Engine default transport is evidence ingest.
- Engine may fallback to `/v1/messages` only when configured (`ENGINE_INGEST_LEGACY_FALLBACK=1`).
- Non-2xx `/v1/messages` status must be propagated to caller (retry/auth handling).

## Local Smoke Checklist

1. Run unified smoke script:
   - `bash ./scripts/e2e_engine_app_smoke.sh`
2. With local runtime up (`pnpm desktop:dev:env`), run live probe:
   - `bash ./scripts/e2e_engine_app_live_probe.sh`
3. Expected:
   - engine ingest tests pass
   - app evidence-ingest contract passes
   - ops-dashboard typecheck/tests pass
   - live auth + `/v1/system/health` + `/v1/finance/projection` return contract-shape 200

## Cutover Sequence (evidence -> fallback-off)

1. Stage A (safe default):
   - `ENGINE_INGEST_TRANSPORT=evidence`
   - `ENGINE_INGEST_LEGACY_FALLBACK=1`
2. Stage B (after stability window):
   - keep transport `evidence`
   - switch fallback to `ENGINE_INGEST_LEGACY_FALLBACK=0`
3. Stability gate before Stage B:
   - unified smoke green (`scripts/e2e_engine_app_smoke.sh`)
   - no sustained ingest non-2xx/retry spikes in logs
   - no operator regression on `/v1/system/health` + `/v1/finance/projection`

## Stage B Rehearsal Evidence (2026-03-06)

- Log bundle: `/tmp/stageb_cutover_20260306_010744`
- Fallback OFF (`ENGINE_INGEST_LEGACY_FALLBACK=0`): PASS
  - `scripts/e2e_engine_app_smoke.sh`
  - `scripts/e2e_engine_app_live_probe.sh`
  - `/Users/min/Downloads/a2/mvp/scripts/quality_gate.sh`
  - `/Users/min/Downloads/a2/mvp/scripts/e2e_evidence_ingest.sh`
  - `/Users/min/Downloads/a2/mvp/scripts/e2e_agentapp_bridge_worker.sh`
- Rollback ON (`ENGINE_INGEST_LEGACY_FALLBACK=1`): PASS
  - `/Users/min/Downloads/a2/mvp/scripts/e2e_evidence_ingest.sh`
  - `/Users/min/Downloads/a2/mvp/scripts/e2e_agentapp_bridge_worker.sh`
- Evidence files:
  - `/Users/min/Downloads/a2/mvp/evidence/e2e_agentapp_bridge_worker_20260306_010755.md`
  - `/Users/min/Downloads/a2/mvp/evidence/e2e_agentapp_bridge_worker_20260306_010756.md`

## Rollback Guidance

- Immediate rollback switch:
  - `ENGINE_INGEST_TRANSPORT=messages`
- Secondary rollback (keep evidence transport but re-enable fallback):
  - `ENGINE_INGEST_TRANSPORT=evidence`
  - `ENGINE_INGEST_LEGACY_FALLBACK=1`
- Keep app endpoint unchanged; transport routing is switched in engine only.
- If dashboard bootstrap behavior regresses, rollback app side only by reverting the `ops-dashboard` commit and keep API/engine as-is.
