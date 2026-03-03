# Engine Evidence Ingest v0

## Endpoint

- `POST /v1/engines/evidence/ingest`
- Required header: `x-workspace-id`
- Required body fields:
  - `schema_version`
  - `engine_id`
  - `engine_token`
  - `events` (`EventEnvelopeV1[]`)

## Security and isolation

- Engine token is verified against the target workspace.
- `workspace_id` and `stream` are server-forced to header workspace:
  - `workspace_id = x-workspace-id`
  - `stream = { stream_type: "workspace", stream_id: x-workspace-id }`
- Incoming `actor` and `actor_principal_id` are ignored and replaced by engine identity.

## Batch behavior

- Max batch size: `100` events.
- Route body limit: `10MB`.
- Per-event guards:
  - `event.data` JSON bytes <= `64KB`
  - `idempotency_key` <= `256`
  - `event_id` <= `128`, `event_type` <= `128`
  - `entity_type` <= `64`, `entity_id` <= `128`
- Uses savepoint-per-event so one bad/duplicate event does not abort the entire batch.
- Response is always ordered 1:1 with input indices:
  - `accepted`
  - `deduped`
  - `rejected` (with `reason_code`)

## Rate limiting

- Request-level DB buckets:
  - global: `engine_ingest_global`
  - per-workspace: `engine_ingest:{workspace_id}`
- On limit, returns contract error `rate_limited` with SQL-computed `retry_after_sec`.

## Retry guidance

- `500` response: retry full batch safely (dedupe handles replay).
- `200` mixed response: retry only rejected events after fixing payload.
- Accepted and deduped events are replay-safe.

