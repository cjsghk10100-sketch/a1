# TASK-206: Events Subject Filters + Capability Revoke Owner Enrichment

## 1) Problem
`/v1/events` currently filters by stream/run/correlation/event_type only. Agent Profile timeline must fetch broad workspace events then client-filter, which is noisy and may miss relevant events under high volume.

Additionally, `agent.capability.revoked` event payload does not include the token owner principal, making principal-scoped timelines harder to match.

## 2) Scope
In scope:
- Add additive filters to `/v1/events`:
  - `subject_agent_id`
  - `subject_principal_id`
- Filters apply against event payload (`data`) fields.
- Enrich `agent.capability.revoked` event data with `issued_to_principal_id`.
- Extend events contract test for subject filters.
- Extend web events API helper with new filter params.
- Update Agent Profile timeline fetch to use subject filters.

Out of scope:
- New migrations/indexes.
- Event type schema version bumps.

## 3) Constraints (Security/Policy/Cost)
- Additive, backward-compatible query behavior.
- No mutation-path policy changes.
- Keep query limits/bounds unchanged.

## 4) Repository context
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/events.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/capabilities.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_events_query.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/events.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Agent Profile change timeline still renders.
  2. Revocation events appear with principal-targeted filtering.

## 6) Step-by-step plan
1. Add subject query params and SQL predicates in `/v1/events`.
2. Enrich revoke event payload with `issued_to_principal_id` in capability revoke route.
3. Add contract tests for subject_agent/principal filtering.
4. Add web helper params and wire Agent Profile timeline fetch to use them.
5. Run typecheck + full contracts.

## 7) Risks & mitigations
- Risk: false-positive principal matches.
- Mitigation: constrain principal filter to explicit keys (`principal_id`, `issued_to_principal_id`).
- Risk: revocation event payload backward assumptions.
- Mitigation: additive field only; existing consumers unaffected.

## 8) Rollback plan
Revert modified files above; query and payload behavior returns to previous baseline.
