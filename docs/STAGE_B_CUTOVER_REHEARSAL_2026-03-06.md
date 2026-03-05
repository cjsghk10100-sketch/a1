# Stage B Cutover Rehearsal (2026-03-06, KST)

## Objective
- Validate Stage B cutover readiness with `ENGINE_INGEST_LEGACY_FALLBACK=0`.
- Validate immediate rollback with `ENGINE_INGEST_LEGACY_FALLBACK=1`.

## Runtime Context
- app repo: `a1` (`/Users/min/Downloads/agent`)
- engine repo: `eg1` (`/Users/min/Downloads/a2/mvp`)
- log bundle: `/tmp/stageb_cutover_20260306_010744`
- API base: `http://127.0.0.1:3000`
- workspace: `ws_dev`

## Stage B Rehearsal (`fallback=0`) - PASS
1. `bash /Users/min/Downloads/agent/scripts/e2e_engine_app_smoke.sh` -> PASS
2. `bash /Users/min/Downloads/agent/scripts/e2e_engine_app_live_probe.sh` -> PASS
3. `ENGINE_INGEST_TRANSPORT=evidence ENGINE_INGEST_LEGACY_FALLBACK=0 bash /Users/min/Downloads/a2/mvp/scripts/quality_gate.sh` -> PASS
4. `ENGINE_INGEST_TRANSPORT=evidence ENGINE_INGEST_LEGACY_FALLBACK=0 bash /Users/min/Downloads/a2/mvp/scripts/e2e_evidence_ingest.sh` -> PASS
5. `ENGINE_INGEST_TRANSPORT=evidence ENGINE_INGEST_LEGACY_FALLBACK=0 bash /Users/min/Downloads/a2/mvp/scripts/e2e_agentapp_bridge_worker.sh` -> PASS

Evidence:
- `/Users/min/Downloads/a2/mvp/evidence/e2e_agentapp_bridge_worker_20260306_010755.md`

## Rollback Rehearsal (`fallback=1`) - PASS
1. `ENGINE_INGEST_TRANSPORT=evidence ENGINE_INGEST_LEGACY_FALLBACK=1 bash /Users/min/Downloads/a2/mvp/scripts/e2e_evidence_ingest.sh` -> PASS
2. `ENGINE_INGEST_TRANSPORT=evidence ENGINE_INGEST_LEGACY_FALLBACK=1 bash /Users/min/Downloads/a2/mvp/scripts/e2e_agentapp_bridge_worker.sh` -> PASS

Evidence:
- `/Users/min/Downloads/a2/mvp/evidence/e2e_agentapp_bridge_worker_20260306_010756.md`

## Result
- Stage B cutover and rollback path both pass in one continuous session.
- No API contract, schema, or reason code change introduced.
