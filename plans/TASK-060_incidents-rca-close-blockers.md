# TASK-060: Incidents + RCA + Close Blockers

## 1) Problem
The system currently has no first-class incident workflow. We cannot reliably track failures through RCA and learning closure, and we cannot enforce “Learn or Die” before incident close.

## 2) Scope
In scope:
- Add incident event contract and IDs.
- Add incident read projections (incident header + learning entries).
- Add `/v1/incidents` API:
  - create incident
  - list incidents
  - get incident detail
  - update RCA
  - append learning entry
  - close incident
- Enforce close blockers:
  - RCA required
  - at least one learning entry required
- Add contract test coverage.
- Update event docs.

Out of scope:
- Survival ledger/daily rollup (TASK-061).
- Lifecycle automation (TASK-062).
- Dedicated web incidents screen.

## 3) Constraints (Security/Policy/Cost)
- Event log remains append-only.
- No secret leakage in incident payloads.
- Stable error codes for blocked close behavior.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/ids.ts`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/index.ts`
  - `/Users/min/Downloads/에이전트 앱/docs/EVENT_SPECS.md`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/index.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/projectorDb.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/package.json`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/incidents.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/029_incidents.sql`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/incidentProjector.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/incidents.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_incidents.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Contract checks:
  - closing before RCA => `409 incident_close_blocked_missing_rca`
  - closing after RCA but before learning => `409 incident_close_blocked_missing_learning`
  - closing after RCA + learning => success and status `closed`

## 6) Step-by-step plan
1. Add shared incident ID/types.
2. Add migration for incident projections.
3. Implement incident projector.
4. Implement incident routes and register them.
5. Add contract test + wire test script.
6. Update event specs docs.

## 7) Risks & mitigations
- Risk: run/room association mismatch.
- Mitigation: validate run and room coherence on create.
- Risk: partial close blocker enforcement in API only.
- Mitigation: store blocker-relevant state in projection and enforce in close endpoint.

## 8) Rollback plan
Revert migration, shared types, projector/routes, and contract test additions in one revert commit.
