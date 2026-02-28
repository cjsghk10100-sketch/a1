# TASK-330 Ingest(_drop) v0.2

## Goal
Implement a local Engine-side ingest bridge that claims items from `_drop/`, uploads artifacts via `/v1/artifacts`, posts `/v1/messages`, and finalizes into `_ingested/` or `_quarantine/` with crash-safe state.

## Scope
1. Add ingest runtime in `apps/engine` (no API contract changes).
2. Wire ingest loop into engine entrypoint behind config flag (`ingest_enabled` default false).
3. Add lightweight local integration test with mock HTTP server.
4. Update docs with ingest item format, directories, and run/debug flow.

## Constraints
1. Single-workspace processing only (`x-workspace-id` always set).
2. Claim gate only by atomic rename to `_processing/`.
3. Streaming sha256/file upload (no full-buffer reads for artifacts).
4. Deterministic idempotency key stable across restarts.
5. 429-aware backoff with `retry_after_sec`.

## Acceptance Checks
1. `pnpm -C apps/engine typecheck`
2. `pnpm -C apps/engine exec tsx test/test_ingest_drop.ts`
3. Manual one-shot smoke: valid item reaches `_ingested/`, permanent 400 reaches `_quarantine/`.
