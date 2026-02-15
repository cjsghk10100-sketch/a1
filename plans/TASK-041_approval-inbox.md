# TASK-041 CEO Approval Inbox (pending/held/decided + decision actions)

## 1) Problem
We need a first real "Control" screen in the Agent OS app: a CEO-facing Approval Inbox that can review and decide approvals emitted by the backend.

## 2) Scope
In scope:
- Implement Approval Inbox UI that:
  - Lists approvals with filters (status)
  - Shows a detail view for a selected approval
  - Allows decisions: approve / deny / hold with optional reason
- Use existing backend API only.
- Ensure visible strings are i18n (en/ko).
- Ensure JSON fields are rendered with basic redaction (never render raw secrets by default).

Out of scope:
- Creating approvals from the UI.
- Timeline/SSE UI and Inspector query UX (other tasks).
- Any backend/DB changes.

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- UI must not show raw secrets; apply a conservative redaction pass for JSON displays.

## 4) Repository context
Relevant backend endpoints:
- `GET /v1/approvals?status=...&room_id=...&limit=...`
- `GET /v1/approvals/:approvalId`
- `POST /v1/approvals/:approvalId/decide`

Files to change (web only):
- `apps/web/src/pages/ApprovalInboxPage.tsx`
- `apps/web/src/i18n/resources.ts`
- Add minimal `apps/web/src/api/*`, `apps/web/src/components/*`, `apps/web/src/utils/*`
- `apps/web/src/styles.css` (small additions only)

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- With local API running, web app can:
  - list approvals by status
  - show a selected approval detail
  - submit a decision and see the updated status

## 6) Step-by-step plan
1) Add a tiny web API client wrapper.
2) Implement Approval list + filters.
3) Implement detail view + decision actions.
4) Add JSON view with redaction.
5) Add i18n keys (en/ko) for all visible strings.
6) Confirm typecheck + CI.

## 7) Risks & mitigations
- Risk: rendering request/context JSON leaks secrets
  - Mitigation: apply conservative redaction on common secret-like keys/values, and do not render raw JSON.

## 8) Rollback plan
Revert this PR (web-only changes).

