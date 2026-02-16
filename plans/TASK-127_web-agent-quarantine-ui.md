# TASK-127: Web Agent Quarantine UI (Status + Actions)

## Dependencies
- TASK-126 (API: `GET /v1/agents/:agentId`, `POST /v1/agents/:agentId/quarantine`, `POST /v1/agents/:agentId/unquarantine`)

## 1) Problem
We added agent quarantine state and egress blocking (TASK-126), but it is not visible in the app UI.
Operators need to:
- see quarantine status (active/inactive) at a glance
- quarantine/unquarantine quickly during incidents
- understand the reason + timestamp

## 2) Scope
In scope:
- Web:
  - Extend Agent Profile page to:
    - fetch agent metadata (`GET /v1/agents/:agentId`)
    - show quarantine status + reason + timestamp
    - provide buttons to quarantine/unquarantine
  - i18n (en/ko) for all new strings

Out of scope:
- Any API/DB changes (already done in TASK-126)
- Automatic quarantine triggers
- Forensics runs

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- UI is summary-first; raw API responses can be behind “Advanced”.
- Quarantine actions must be idempotent and safe to click repeatedly.

## 4) Repository context
Relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

New files:
- None expected

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- Agent Profile shows:
  - quarantine status pill (active/inactive)
  - quarantine reason + quarantined_at when active
- Quarantine/unquarantine buttons work against local API:
  - quarantine sets status to active
  - unquarantine clears it

## 6) Step-by-step plan
1. Add web API helpers for agent get + quarantine actions.
2. Add UI section to Agent Profile to display current quarantine state.
3. Wire quarantine/unquarantine buttons with optimistic refresh (refetch).
4. Add i18n strings (en/ko).
5. Run typecheck.

## 7) Risks & mitigations
- Risk: API returns 404 for old DBs/missing migrations.
  - Mitigation: show “not available” and keep other sections working.

## 8) Rollback plan
Revert PR (web-only changes).

