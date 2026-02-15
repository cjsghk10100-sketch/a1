# TASK-043 Notifications feed (local read cursor, no server state)

## 1) Problem
We need a "Notifications" screen that highlights new/unread room activity without committing to a server-side unread/read model yet. This avoids locking the wrong contract early while still enabling day-1 operational use.

## 2) Scope
In scope:
- Add a Notifications page in `apps/web` that:
  - Lets the user select a room (or paste a `room_id`)
  - Fetches "unread" events from the room stream using the Events query API:
    - `GET /v1/events?stream_type=room&stream_id=...&from_seq=...`
  - Stores a per-room local read cursor (`last_read_seq`) in localStorage (no backend state)
  - Allows "mark all as read" (advance cursor to latest fetched)
  - Renders events with conservative redaction for JSON payloads
- All visible strings are i18n (en/ko).

Out of scope:
- Server-side unread/read semantics, per-user feeds, or persistence.
- Push notifications and background polling.
- Any backend/DB changes.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Never render raw secrets; use conservative redaction for JSON views.

## 4) Repository context
Relevant backend endpoints:
- Rooms: `GET /v1/rooms`
- Events: `GET /v1/events` (stream filters + from_seq)

Files to change (web only):
- `apps/web/src/App.tsx` (add route/nav)
- `apps/web/src/pages/NotificationsPage.tsx` (new)
- `apps/web/src/api/events.ts` (extend query params support, additive)
- `apps/web/src/i18n/resources.ts`
- `apps/web/src/styles.css` (small additions only)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- With local API running and room activity present:
  - notifications can fetch unread events since local cursor
  - mark-as-read advances cursor and subsequent fetch returns none

## 6) Step-by-step plan
1) Add Notifications route and page skeleton.
2) Extend events API helper to support stream filters/from_seq.
3) Implement local read cursor storage and fetch/mark-read actions.
4) Add i18n keys (en/ko) for all new strings.
5) Confirm typecheck + CI.

## 7) Risks & mitigations
- Risk: unread model will change later
  - Mitigation: keep state local; treat this as a UI-only prototype over stable event contracts.

## 8) Rollback plan
Revert this PR (web-only changes).

