# TASK-135: Open Inspector From Timeline/Notifications (No Copy/Paste)

## 1) Problem
Today, getting from an event in Timeline/Notifications to the Inspector often requires copying/pasting `run_id` or `correlation_id`.
This is slow and error-prone.

## 2) Scope
In scope:
- Web:
  - Add an “Inspector” action on event cards in:
    - Timeline (`/timeline`)
    - Notifications (`/notifications`)
  - Behavior:
    - If `run_id` exists: navigate to `/inspector?run_id=...`
    - Else: navigate to `/inspector?correlation_id=...`

Out of scope:
- Any API/DB changes.
- Changing Inspector behavior/selection.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Use existing Inspector query params (`run_id`, `correlation_id`) and existing i18n keys where possible.

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/TimelinePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/NotificationsPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/styles.css`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- Manual:
  - On Timeline, click “Inspector” on an event card with a `run_id` -> Inspector loads that run.
  - On an event card without `run_id` -> Inspector opens correlation mode for that event’s `correlation_id`.

## 6) Step-by-step plan
1. Add an `Inspector` action row to event cards in Timeline/Notifications.
2. Add minimal CSS for the action row layout (reuse existing button styles).
3. Run typecheck.

## 7) Risks & mitigations
- Risk: Some events have no `run_id`.
  - Mitigation: fall back to `correlation_id` navigation.

## 8) Rollback plan
Revert PR (web-only).

