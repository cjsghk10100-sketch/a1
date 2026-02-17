# TASK-138: Work Surface Message Sender Controls

## 1) Problem
The `/work` page can send messages, but it always sends as the default sender (`user:anon`).
To actually operate agents locally (and to make the event feed more meaningful), we need to choose who is sending:
- `sender_type` (user/agent/service)
- `sender_id` (e.g. `anon`, `ceo`, `research_bot`)

## 2) Scope
In scope:
- Web UI:
  - Add sender controls to the Work message composer.
  - Persist last-used sender in `localStorage`.

Out of scope:
- Any API changes (endpoint already supports `sender_type`/`sender_id`).
- Auth/RBAC and capability enforcement.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- Keep changes additive; do not break existing flows.

## 4) Repository Context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/styles.css`

## 5) Acceptance Criteria (Observable)
- `pnpm -r typecheck`
- Manual smoke:
  - Open `http://localhost:5173/work`
  - Select a room + thread
  - Set sender to `agent:research_bot` and send a message
  - The message list shows `agent:research_bot` as the sender.

## 6) Step-by-step Plan
1. Add `sender_type` select + `sender_id` input near the composer.
2. Persist values in `localStorage`.
3. Wire `postThreadMessage()` call to include sender fields.
4. Add i18n labels.
5. Run typecheck.

## 7) Risks & Mitigations
- Risk: Users send invalid/empty sender ids.
  - Mitigation: Trim + require non-empty before send.

## 8) Rollback Plan
Revert PR (UI-only change).

