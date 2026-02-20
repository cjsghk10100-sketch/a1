# TASK-203: Work Egress Requests Visibility (Room Scope)

## 1) Problem
Egress gateway decisions are persisted (`sec_egress_requests`) and exposed by API, but Work UI has no room-scoped list. Operators cannot quickly inspect external-write decisions (allow/require_approval/deny, blocked, reason) during local operation.

## 2) Scope
In scope:
- Add web API helper for `GET /v1/egress/requests`.
- Add Work page section to load/render room-scoped egress request history.
- Add EN/KO i18n keys for egress section labels/states.

Out of scope:
- API/DB changes.
- Egress request creation UI.
- Approval decision UI changes.

## 3) Constraints (Security/Policy/Cost)
- Read-only observability feature only.
- Keep room/request context guards consistent with existing Work async patterns.
- No secret exposure; render only response fields and optional JSON details.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/egress.ts` (contract reference)
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/api/egress.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Open `/work`, select room.
  2. Trigger an egress request via existing API path (or existing flows).
  3. In Work egress section, refresh and verify row shows action/decision/blocked/reason/approval.

## 6) Step-by-step plan
1. Add `apps/web/src/api/egress.ts` helper and row type.
2. Add Work page state/reload function with room-context guard.
3. Wire reload on room change and provide manual refresh button.
4. Render egress rows in Work section with compact metadata + details.
5. Add i18n keys (EN/KO), run checks.

## 7) Risks & mitigations
- Risk: stale responses after room switch.
- Mitigation: reuse `roomIdRef` guard before state writes.
- Risk: noisy UI.
- Mitigation: compact list, room-scoped only, hide when empty.

## 8) Rollback plan
Revert:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/egress.ts`
- Work egress section/state changes in `WorkPage.tsx`
- i18n keys in `resources.ts`
- `/Users/min/Downloads/에이전트 앱/plans/TASK-203_work-egress-requests-visibility.md`
