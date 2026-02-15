# TASK-009 SSE stream for room events (read-only)

## Dependencies
- TASK-010 event store migration (evt_events exists)
- TASK-005 API skeleton

## 1) Problem
We need a lightweight realtime mechanism for UI:
- stream evt_events for a room from stream_seq

## 2) Scope
In scope:
- GET /v1/streams/rooms/:roomId?from_seq=
- Return text/event-stream
- Initial backlog + simple polling loop (no websockets)

Out of scope:
- Auth, resume tokens, compression tuning

## 3) Constraints
- Must not block DB with long transactions
- Must handle client disconnect cleanly

## 4) Repository context
Add:
- /apps/api/src/routes/v1/streams.ts

Modify:
- /apps/api/src/routes/v1/index.ts

## 5) Acceptance criteria
- `curl -N http://localhost:<PORT>/v1/streams/rooms/<roomId>?from_seq=0` returns events as they are appended
- Disconnect stops server work

## 6) Steps
1) Implement SSE headers + flush
2) Parse from_seq default 0
3) Loop:
   - query next batch: evt_events where stream_type='room' and stream_id=:roomId and stream_seq > cursor order by stream_seq limit 100
   - emit as SSE `data: <json>\n\n`
   - sleep 1s if no new events
4) On req close => stop loop

## 7) Risks
- Polling cost
  - Mitigation: small sleep; later replace with LISTEN/NOTIFY

## 8) Rollback
Revert streams route.
