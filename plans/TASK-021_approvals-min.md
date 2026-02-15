# TASK-021: Approvals (request/decide/hold) - DB + API + projector + tests

## 1) Problem
We need a durable approvals substrate (request + decision + audit trail) before building the Approval Inbox/Timeline/Inspector UI.
Without an approvals table + events + projection, UI and policy enforcement will be forced to scrape raw events or embed state in ad-hoc places.

## 2) Scope
In scope:
- Approval events:
  - `approval.requested` (v1)
  - `approval.decided` (v1) with decision `approve|deny|hold`
- Projection table for current approval state (`proj_approvals`)
- API endpoints:
  - `POST /v1/approvals` (request)
  - `POST /v1/approvals/:approvalId/decide` (approve/deny/hold)
  - `GET /v1/approvals` (list)
  - `GET /v1/approvals/:approvalId` (detail)
- Contract test:
  - approval.requested and approval.decided appear in **room SSE** when `room_id` is provided
  - correlation_id is stable across request/decide; decide has causation_id = request event_id
  - projection row is updated accordingly

Out of scope:
- Policy enforcement or kill-switch (TASK-022)
- Runs/steps/toolcalls schema (future tasks)
- Any UI work

## 3) Constraints (Security/Policy/Cost)
- No secrets committed; `.env` must remain untracked.
- Approval events must be append-only and auditable (store correlation/causation ids).
- Keep schema additive and future-proof (store request/decision details as jsonb where appropriate).

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/api/src/eventStore/index.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/coreProjector.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/streams.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_room_sse.ts`

New files to add:
- `/Users/min/Downloads/에이전트 앱/apps/api/migrations/005_approvals.sql`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/approvals.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/approvalProjector.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/approvals.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_approvals.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes
- CI is green (typecheck + contract tests)
- `POST /v1/approvals` returns `approval_id` and writes projection row
- `POST /v1/approvals/:id/decide` updates projection row and emits `approval.decided` in SSE when room-scoped

## 6) Step-by-step plan
1. Add shared approvals contract types (`packages/shared`).
2. Add `proj_approvals` table migration.
3. Implement `approvalProjector` and wire routes to apply it after appending events.
4. Implement approvals v1 routes (request/decide/list/detail).
5. Add contract test and update api test script to run both contract tests.
6. Typecheck, open PR, ensure CI green.

## 7) Risks & mitigations
- Risk: scope/grants need changes later.
  - Mitigation: store request/decision payloads as jsonb and keep core columns minimal + indexed.

## 8) Rollback plan
Revert the PR commit(s). If DB migration was applied in local dev, drop the `proj_approvals` table or reset DB.

