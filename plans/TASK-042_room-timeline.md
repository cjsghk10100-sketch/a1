# TASK-042 Room Timeline UI (SSE consumer)

## 1) Problem
We need the Agent OS "Timeline" screen to provide immediate observability by consuming the room SSE stream and rendering the room feed as an ordered event list.

## 2) Scope
In scope:
- Implement Timeline UI that:
  - Lists rooms and allows selecting a room (or manual room id input)
  - Connects to room SSE: `GET /v1/streams/rooms/:roomId?from_seq=...`
  - Renders events in order and supports reconnect (resume from last seq)
  - Shows event details (redacted JSON) on demand
- Use existing backend API only.
- All visible strings are i18n (en/ko).
- No raw secrets rendered (use conservative redaction for JSON fields).

Out of scope:
- Notifications unread/read semantics and storage.
- Inspector query UX and run-focused drilldowns (other tasks).
- Any backend/DB changes.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep a conservative default: redact JSON fields in UI.

## 4) Repository context
Relevant backend endpoints:
- `GET /v1/rooms`
- `GET /v1/streams/rooms/:roomId?from_seq=...` (SSE)

Files to change (web only):
- `apps/web/src/pages/TimelinePage.tsx`
- `apps/web/src/i18n/resources.ts`
- Add minimal `apps/web/src/api/rooms.ts` and `apps/web/src/api/streams.ts` (types)
- `apps/web/src/styles.css` (small additions only)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- With local API running and at least one room created:
  - Timeline lists rooms
  - Connects to SSE and shows new events as they arrive
  - Reconnect resumes from the last received `stream_seq`

## 6) Step-by-step plan
1) Add room list API helper.
2) Implement SSE connect/disconnect/reconnect logic with `from_seq`.
3) Render event list with expandable, redacted JSON detail.
4) Add i18n keys (en/ko) for all UI text.
5) Confirm typecheck + CI.

## 7) Risks & mitigations
- Risk: large/secret JSON displayed in UI
  - Mitigation: default redaction + collapsed details.
- Risk: SSE reconnect replays too many events
  - Mitigation: reconnect with `from_seq=last_seq`.

## 8) Rollback plan
Revert this PR (web-only changes).

