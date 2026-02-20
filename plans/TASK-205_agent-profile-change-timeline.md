# TASK-205: Agent Profile Change Timeline (Permissions/Growth)

## 1) Problem
Agent Profile currently shows current permission/growth state, but not a compact timeline of *what changed when*.
Operators cannot quickly correlate capability grants/revokes, trust shifts, quarantine transitions, and learning signals for one agent.

## 2) Scope
In scope:
- Extend `/v1/events` query with additive multi-type filter:
  - `event_types` (comma-separated list)
- Keep existing `event_type` behavior unchanged (backward compatible).
- Add web API helper support for `event_types`.
- Add Agent Profile timeline card that shows recent change events for selected agent.
  - Uses workspace events query + local filtering by `agent_id`/`principal_id` in payload.
- Add EN/KO i18n keys for timeline labels.

Out of scope:
- Event schema changes.
- New DB tables or migrations.
- Inspector page changes.

## 3) Constraints (Security/Policy/Cost)
- Read-only observability feature; no execution-path policy changes.
- Preserve append-only audit semantics.
- Keep request count low (single query with `event_types` list).

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/events.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_events_query.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/api/events.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Manual:
  1. Open Agent Profile for an agent with trust/capability/quarantine activity.
  2. Timeline card shows recent events with type/time/actor/summary.
  3. Empty state appears when no matched events.

## 6) Step-by-step plan
1. Add `event_types` parsing/filtering in `/v1/events` (CSV, trimmed, deduped, bounded).
2. Add contract test assertion that multi-type query returns at least requested types.
3. Update web `listEvents` helper to accept `event_types` array and include actor metadata fields in type.
4. Add Agent Profile “change timeline” section (Growth tab) using event query + client-side relevance filter.
5. Add i18n keys and verify UI strings are bilingual.
6. Run typecheck + full API contracts.

## 7) Risks & mitigations
- Risk: Over-fetching irrelevant workspace events.
- Mitigation: apply server-side `event_types` filter and limit, then client-side relevance filter.
- Risk: Event payload shape variance across types.
- Mitigation: defensive extractor helpers with unknown-safe checks and fallbacks.

## 8) Rollback plan
- Revert changes in the five files above.
- Existing event query and Agent Profile behavior will return to current baseline.
