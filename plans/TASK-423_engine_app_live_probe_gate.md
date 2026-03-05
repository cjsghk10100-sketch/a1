# TASK-423: Engine-App Live Probe Gate (local runtime)

## Goal
Add one deterministic live probe script for local ops that verifies app runtime auth + core dashboard APIs are reachable and return contract-shape 200 responses.

## Scope
- add `scripts/e2e_engine_app_live_probe.sh`
- update `docs/ENGINE_APP_VERSION_MATRIX.md` checklist
- keep existing smoke script and tests unchanged

## Acceptance
1. `bash ./scripts/e2e_engine_app_live_probe.sh` passes when local runtime is up with `.env.desktop`.
2. Script fails fast with clear reason when auth/bootstrap/env is missing.
3. No new dependencies.
