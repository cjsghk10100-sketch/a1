# EVENT_SPECS

## Principles
- Event log is append-only.
- Event payloads must be versioned.
- Never include raw secrets/PII in payloads.

## Event Catalog (Initial)

### 1) `approval.requested.v1`
- `eventId`: string
- `occurredAt`: ISO datetime
- `actorId`: string
- `requestType`: `external_write | permission_change | key_change | cron_change | funds_action`
- `resource`: string
- `reason`: string
- `status`: `pending`

### 2) `approval.resolved.v1`
- `eventId`: string
- `occurredAt`: ISO datetime
- `resolverId`: string
- `requestId`: string
- `decision`: `approved | rejected`
- `comment`: string

### 3) `learning.ledger.recorded.v1`
- `eventId`: string
- `occurredAt`: ISO datetime
- `incidentId`: string
- `rcaSummary`: string
- `actions`: string[]
- `ownerId`: string

### 4) `cost.tracked.v1`
- `eventId`: string
- `occurredAt`: ISO datetime
- `scope`: string
- `costUsd`: number
- `budgetWindow`: `daily | weekly | monthly`
