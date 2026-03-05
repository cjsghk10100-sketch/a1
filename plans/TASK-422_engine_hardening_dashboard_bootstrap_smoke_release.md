# TASK-422: PR-18B engine hardening + dashboard first-entry stabilization + E2E smoke + release baseline

## 1) Problem
- Engine ingest path currently treats HTTP/API failures with limited structured telemetry, making fallback/retry/quarantine observability weak during ops.
- Ops dashboard still shows first-entry UNKNOWN/skeleton jitter on initial route open before first successful poll.
- Engine↔App smoke checks are split across manual commands and are not captured as one repeatable script.
- Release compatibility baseline exists but is not yet consolidated into an explicit app+engine runbook document.

## 2) Scope
In scope:
- apps/engine ingest hardening (reason-code classification constants, transport/fallback visibility logs, deterministic event_id helper consistency)
- ops-dashboard first-entry UX stabilization (avoid UNKNOWN downgrade during initial panel mount/route switch)
- add one deterministic E2E smoke script in app repo to run core checks in sequence
- add/update release baseline doc with pinned checks + rollback path

Out of scope:
- DB schema/migration changes
- API contract breaking changes
- new dependencies
- projector/read-model logic changes

## 3) Constraints (Security/Policy/Cost)
- Keep Request != Execute boundary unchanged.
- No secret/token/PII logging.
- Reuse existing reason_code map (no additions/renames).
- Keep changes minimal and additive.

## 4) Repository context
- Engine:
  - apps/engine/src/ingestDrop.ts
  - apps/engine/src/index.ts
  - apps/engine/test/test_ingest_drop.ts
- Dashboard:
  - apps/ops-dashboard/src/App.tsx
  - apps/ops-dashboard/src/hooks/usePolling.ts
  - apps/ops-dashboard/src/panels/HealthPanel/index.tsx
  - apps/ops-dashboard/src/panels/FinancePanel/index.tsx
  - apps/ops-dashboard/src/test/ops_dashboard.spec.tsx
- Docs/scripts:
  - docs/ENGINE_APP_VERSION_MATRIX.md
  - docs/ENGINE_EVIDENCE_INGEST_v0.md
  - scripts/

## 5) Acceptance criteria (observable)
- Engine ingest tests pass:
  - pnpm -C apps/engine test:ingest
- Dashboard tests pass:
  - pnpm -C apps/ops-dashboard typecheck
  - pnpm -C apps/ops-dashboard test
- API ingest contract passes:
  - set -a; source ./.env.desktop; set +a; pnpm -C apps/api exec tsx test/contract_engine_evidence_ingest.ts
- New E2E smoke script executes without failures under local desktop env.

## 6) Step-by-step plan
1. Add engine-side hardening constants + response classification and targeted logs without changing API behavior.
2. Add dashboard bootstrap guard to prevent first-entry UNKNOWN/skeleton flicker from route remount transitions.
3. Add/verify one script that runs engine+dashboard+contract smoke checks in sequence.
4. Update release baseline docs with command matrix and rollback knobs.
5. Run full verification and summarize outcomes.

## 7) Risks & mitigations
- Risk: dashboard status masking real failures.
- Mitigation: only suppress transient empty snapshots; keep explicit error states unchanged.
- Risk: engine hardening may alter retry semantics.
- Mitigation: keep classification sets explicit and default unknown failures to transient.

## 8) Rollback plan
- Revert single PR commit.
- Runtime rollback knobs:
  - ENGINE_INGEST_ENABLED=0
  - ENGINE_INGEST_TRANSPORT=messages (if needed)
  - dashboard polling can be disabled by reverting app commit only.
