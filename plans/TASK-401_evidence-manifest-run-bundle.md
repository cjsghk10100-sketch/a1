# TASK-401: Evidence Bundle Manifest (Run -> 1 verifiable evidence manifest)

## 1) Problem
Runs/steps/toolcalls/artifacts are durable, but there is no single verifiable run-level evidence bundle.
Without a 1:1 manifest:
- audits are harder,
- scorecards are less reproducible,
- run completion lacks explicit evidence completeness.

## 2) Scope
In scope:
- event type: `evidence.manifest.created` (v1)
- projection: `proj_evidence_manifests` keyed by `run_id` (1:1)
- projector for `evidence.manifest.created`
- API:
  - `GET /v1/runs/:runId/evidence`
  - `POST /v1/runs/:runId/evidence/finalize` (idempotent)
- auto-finalize on `run.completed` / `run.failed`
- shared IDs/contracts for evidence manifest
- contract test `apps/api/test/contract_evidence_manifest.ts`

Out of scope:
- UI work
- mandatory historical backfill

## 3) Constraints
- additive only; no breaking `evt_events` / core `proj_*`
- manifest hash must be deterministic (`stableStringify` + `sha256`)
- pointer-only payload (IDs/hashes), no secret payload embedding
- idempotent finalization using `idempotency_key=evidence_manifest:<run_id>`

## 4) Schema
Migration `039_evidence_manifests.sql`:
- table `proj_evidence_manifests`
  - `evidence_id TEXT PK`
  - `workspace_id TEXT NOT NULL`
  - `run_id TEXT NOT NULL UNIQUE REFERENCES proj_runs(run_id)`
  - `room_id TEXT NULL`, `thread_id TEXT NULL`
  - `correlation_id TEXT NOT NULL`
  - `run_status TEXT NOT NULL CHECK (run_status IN ('succeeded','failed'))`
  - `manifest JSONB NOT NULL`
  - `manifest_hash TEXT NOT NULL`
  - `event_hash_root TEXT NOT NULL`
  - `stream_type TEXT NOT NULL`, `stream_id TEXT NOT NULL`
  - `from_seq BIGINT NOT NULL`, `to_seq BIGINT NOT NULL`, `event_count INTEGER NOT NULL`
  - `finalized_at TIMESTAMPTZ NOT NULL`
  - `created_at TIMESTAMPTZ NOT NULL`, `updated_at TIMESTAMPTZ NOT NULL`
  - `last_event_id TEXT NOT NULL`

## 5) Manifest contract
`EvidenceManifestV1` includes:
- run identity/status/correlation
- step/toolcall/artifact ID sets
- stream window (`stream_type`,`stream_id`,`from_seq`,`to_seq`,`event_count`)
- ordered event pointers (`event_id`,`stream_seq`,`event_hash`,`event_type`)
- completeness flags (`terminal_event_present`,`all_toolcalls_terminal`,`artifact_count`)

## 6) Edge cases
- ended run with no steps/toolcalls/artifacts => valid empty pointer sets
- workspace-stream runs (no room) supported
- repeated finalize returns existing manifest (no second event)

## 7) Acceptance
- each ended run has exactly one manifest (1:1 run_id)
- manifest hash/event hash root deterministic
- contract tests pass

## 8) Risks
- race around finalization:
  - mitigated by idempotency key + unique(run_id) projection + retry-safe endpoint
- manifest size growth:
  - mitigated by pointer-only design

## 9) Rollback
- revert PR
- reset environments can drop `proj_evidence_manifests` through migration reset
