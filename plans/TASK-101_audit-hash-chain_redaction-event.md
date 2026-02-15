# TASK-101: Audit Hash Chain + Redaction Event (tamper-evidence, append-only safe)

## Dependencies
- TASK-100 (principals/zone columns) recommended but not strictly required

## 1) Problem
We have an append-only event store, but we lack tamper-evidence:
- A privileged DB operator could mutate history (schema-level protections help, but we want verifiable integrity).
- We also need a formal mechanism for “deletion”: we do not delete events, we append a redaction marker.

We must add this without mutating old rows (append-only trigger blocks UPDATE).

## 2) Scope
In scope:
- DB:
  - Add `prev_event_hash` + `event_hash` columns to `evt_events` (nullable for compatibility).
- Runtime:
  - For **new events only** (after this PR), compute:
    - `prev_event_hash`: previous event hash in the same stream, if present.
    - `event_hash`: SHA256 over a stable canonical representation of the event + prev hash.
  - Hash chain is **per stream** (`stream_type`, `stream_id`, `stream_seq` ordering).
- Event contract:
  - Define event type `event.redacted` (v1) as an append-only marker.
    - Payload includes `target_event_id`, `reason`, and intended `redaction_level`.
  - (No read-time masking yet; that comes with Secrets/DLP task.)
- Tests:
  - Add contract test verifying hashes are written for newly appended events and the chain links within a stream.

Out of scope:
- Backfilling hashes for existing historical events (would require UPDATE).
- Signed events / external anchoring.
- Read-time redaction masking.

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**:
  - Columns must be nullable so old rows remain valid.
  - Existing inserts must not fail if hash calculation is temporarily disabled.
- Keep hashing deterministic (stable JSON/canonicalization).
- No secrets committed.

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/eventStore/index.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/eventStore/appendEvent.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/001_evt_event_store.sql`

New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/011_evt_events_hash_chain.sql`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/security/hashChain.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_audit_hash_chain.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green
- Newly appended events have `event_hash` set (non-empty)
- For two consecutive events in the same stream, `prev_event_hash` of the later equals `event_hash` of the earlier (when earlier has a hash)

## 6) Step-by-step plan
1. Add migration: `evt_events` add `prev_event_hash`, `event_hash` (TEXT NULL).
2. Implement stable canonical stringify (sorted keys) for JSON fields.
3. In append transaction:
   - after allocating `stream_seq`, fetch previous row hash for `(stream_type, stream_id, stream_seq-1)`
   - compute current hash and insert into `evt_events`
4. Add/extend shared event types list to include `event.redacted` (types only; no endpoint required yet).
5. Add contract test that appends a couple events into a stream and asserts hash linkage.

## 7) Risks & mitigations
- Risk: Hashing adds overhead.
  - Mitigation: hash only once on write; keep canonicalization small and streaming-safe.
- Risk: Existing streams may have previous events without hashes, creating a “chain gap”.
  - Mitigation: define “cutover”: chain is valid from first hashed event onward; verify only hashed segments.

## 8) Rollback plan
Revert the PR. Keep columns; they are additive and safe. If necessary, remove hash computation in code while leaving schema intact.

