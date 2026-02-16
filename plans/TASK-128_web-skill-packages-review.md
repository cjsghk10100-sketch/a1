# TASK-128: Web Skill Package Review UI (Supply Chain)

## Dependencies
- TASK-106 (Skill supply-chain API)

## 1) Problem
We have OS-level supply-chain primitives (skill packages + verification/quarantine), but no UI to review them.
As a result, operators can’t easily:
- see pending/quarantined packages
- manually verify pending packages
- quarantine packages discovered to be unsafe

## 2) Scope
In scope:
- Web:
  - Add a “Skill packages” card to Agent Profile (Permissions tab).
  - Fetch package list via `GET /v1/skills/packages` with simple filters:
    - status: `pending|verified|quarantined|all`
    - skill_id (optional)
    - limit
  - Actions:
    - verify pending packages via `POST /v1/skills/packages/:packageId/verify`
    - quarantine non-quarantined packages via `POST /v1/skills/packages/:packageId/quarantine` (reason required in UI)
  - i18n (en/ko) for all new strings.

Out of scope:
- API/DB changes
- Dynamic analysis runner (sandbox execution)
- Agent-scoped package view (join table) and bulk import UI

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- UI is summary-first; full manifest JSON is behind “Advanced”.
- Quarantine is treated as terminal (cannot be reverted in UI).

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files (likely):
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/skillPackages.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- Agent Profile shows a card listing skill packages.
- From the UI:
  - pending packages can be verified
  - packages can be quarantined with a reason

## 6) Step-by-step plan
1. Add web API helpers for list/verify/quarantine skill packages.
2. Add UI card with filters + list + actions.
3. Add i18n keys (en/ko).
4. Run typecheck.

## 7) Risks & mitigations
- Risk: API not present on older DBs / missing migrations.
  - Mitigation: show “not available” gracefully.

## 8) Rollback plan
Revert PR (web-only changes).

