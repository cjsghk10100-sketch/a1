# TASK-100: Principals + actor_principal_id + zone (additive envelope hardening)

## Dependencies
- Existing event store + routes + projectors

## 1) Problem
We need a stable identity model for auditing and future authz:
- Today we only have `actor_type` + `actor_id` in events (`service|user`).
- We also need `zone` (sandbox/supervised/high_stakes) attached to events to support OS security posture and growth.

We must introduce these without breaking existing APIs/UI/contract tests.

## 2) Scope
In scope:
- DB:
  - Add `sec_principals` table (principal registry).
  - Add to `evt_events`:
    - `actor_principal_id` (TEXT, nullable)
    - `zone` (TEXT, NOT NULL, default `supervised`, CHECK in `('sandbox','supervised','high_stakes')`)
- Shared contract:
  - Extend `EventEnvelopeV1` with **optional** fields:
    - `actor_principal_id?: string`
    - `zone?: 'sandbox'|'supervised'|'high_stakes'`
- API/runtime:
  - When appending events, resolve a principal for legacy actors (`actor_type`/`actor_id`) using `sec_principals`:
    - create-on-demand (get-or-create) with UNIQUE `(legacy_actor_type, legacy_actor_id)`
  - Set `actor_principal_id` and `zone` for new events (default `supervised` when absent).
  - Include `actor_principal_id` and `zone` in:
    - `/v1/events` responses
    - `/v1/events/:eventId` responses
    - room SSE stream payloads

Out of scope:
- Capability tokens, delegation, or auth enforcement (TASK-103/104).
- Changing existing `actor_type` values or DB CHECK constraints (keep `service|user` for now).
- Any UI changes (adding fields is backward compatible).

## 3) Constraints (Security/Policy/Cost)
- **Compatibility guarantee**:
  - DB migration must be additive: old rows remain valid.
  - Existing event inserts must keep working (new columns have default/nullable).
  - Existing endpoints must not change semantics; only add fields to payloads.
- No secrets committed.

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/eventStore/index.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/eventStore/appendEvent.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/events.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/streams.ts`
- `/Users/min/Downloads/에이전트 애전트 앱/packages/shared/src/events.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/010_principals_actor_zone.sql`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/security/principals.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI green (typecheck + contract tests)
- New events include `actor_principal_id` and `zone` (defaults to `supervised`).
- Existing web UI pages continue working without changes.

## 6) Step-by-step plan
1. Add migration:
   - Create `sec_principals`:
     - `principal_id` pk (ULID/UUID string)
     - `principal_type` CHECK in `('user','agent','service')`
     - `legacy_actor_type` CHECK in `('service','user')` NULL
     - `legacy_actor_id` NULL
     - UNIQUE `(legacy_actor_type, legacy_actor_id)` (partial unique where both non-null)
     - timestamps
   - Alter `evt_events`:
     - add `actor_principal_id` nullable
     - add `zone` NOT NULL default 'supervised' with CHECK
2. Update shared type `EventEnvelopeV1` (optional fields).
3. Implement `ensurePrincipalForLegacyActor(tx, actor_type, actor_id)`:
   - lookup by `(legacy_actor_type, legacy_actor_id)`
   - insert if missing
4. In event append path:
   - populate `actor_principal_id` (get-or-create)
   - populate `zone` default 'supervised' if missing
5. Update event queries and SSE selects to include new columns.
6. Run contract tests; adjust only if tests assert exact keys.

## 7) Risks & mitigations
- Risk: Extra SELECT/INSERT on each event append increases latency.
  - Mitigation: cache principal ids in-process (simple LRU) keyed by `(actor_type, actor_id)`; optional optimization.
- Risk: Adding fields to responses surprises a client doing strict JSON validation.
  - Mitigation: current web client is tolerant; we are additive-only.

## 8) Rollback plan
Revert the PR. If migration applied locally, drop `sec_principals` and the added columns in a new migration (do not UPDATE/DELETE event rows).

