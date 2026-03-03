# TASK-417 PR-18 Engine Evidence Ingest Contract Lock

## Scope
- Keep `/v1/engines/evidence/ingest` behavior unchanged.
- Add minimal contract-lock coverage for ingest safety invariants.
- No schema/event/reason_code changes.

## Changes
1. Extend `apps/api/test/contract_engine_evidence_ingest.ts`:
   - reject batch size over 100 (`invalid_payload_combination`)
   - reject unknown `event_type`
   - reject `event_version` above allowlist max
   - assert deterministic `results[i].index === i`
   - assert `rate_limited` response includes `retry_after_sec`
2. Update `docs/ENGINE_EVIDENCE_INGEST_v0.md` with explicit contract-lock bullets.

## Acceptance checks
- `pnpm -C apps/api typecheck`
- `DATABASE_URL=... AUTH_ALLOW_LEGACY_WORKSPACE_HEADER=1 NODE_ENV=test pnpm -C apps/api exec tsx test/contract_engine_evidence_ingest.ts`
