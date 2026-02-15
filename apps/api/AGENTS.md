# API Package Instructions

## API responsibilities
- Event Store (append-only) + Projections
- Policy Gate (ALLOW / DENY / REQUIRE_APPROVAL)
- Approvals + Grants
- Discord ingest normalization (optional service)

## Hard rules
- Never delete events. No UPDATE/DELETE in evt_events.
- Enforce kill-switch flag in policy evaluation.
- All endpoints must return stable error codes + reason_code.

## Testing
- Add unit tests for policy decisions and approval flows.
- Add integration tests for event append + projection updates.
