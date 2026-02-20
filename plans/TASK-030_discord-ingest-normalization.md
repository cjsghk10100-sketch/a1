# TASK-030: Discord Ingest Normalization (Messages + Channel Mapping)

## 1) Problem
The system has no normalized storage for inbound Discord messages and no mapping from Discord channels to room ids.
Without this, Discord-origin events cannot be safely deduplicated or correlated to room/workspace scope for later parsing workflows.

## 2) Scope
In scope:
- Add DB tables for Discord channel mappings and ingested Discord messages.
- Add API endpoints to upsert/list channel mappings.
- Add API endpoint to ingest raw Discord messages with idempotent dedupe by discord message id.
- Add read endpoint for ingested messages (debug/verification).
- Add shared types for Discord ingest contracts/events.
- Add contract test for mapping + ingest + dedupe behavior.
- Update docs and backlog status.

Out of scope:
- Parsing `@event` lines into domain actions (TASK-031).
- Emoji reply to approval decision mapping (TASK-032).
- Any Discord bot/webhook runtime wiring.

## 3) Constraints (Security/Policy/Cost)
- Store raw payload minimally and avoid secrets/token persistence.
- Dedupe must be deterministic (`workspace_id + discord_message_id` unique).
- Mapping/ingest must remain workspace-scoped via `x-workspace-id`.
- Keep implementation additive; do not alter existing event/projector behavior.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/index.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/package.json`
  - `/Users/min/Downloads/에이전트 앱/docs/EVENT_SPECS.md`
  - `/Users/min/Downloads/에이전트 앱/BACKLOG.md`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/032_discord_ingest.sql`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/discordIngest.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_discord_ingest.ts`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/discord.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Contract checks:
  - channel mapping upsert/list works.
  - ingest writes first message and returns `deduped=false`.
  - second ingest with same discord message id returns `deduped=true`.
  - ingested row resolves mapped `room_id`.

## 6) Step-by-step plan
1. Add shared Discord ingest types/events.
2. Add migration for mapping/message tables and indexes.
3. Implement discord ingest routes and register under v1.
4. Add contract test and include in API test script.
5. Update event specs/backlog.

## 7) Risks & mitigations
- Risk: accidental duplicate inserts under concurrent ingest.
- Mitigation: DB unique constraint + `ON CONFLICT DO NOTHING` dedupe path.
- Risk: wrong workspace mapping lookup.
- Mitigation: enforce workspace-scoped queries for both mapping and messages.

## 8) Rollback plan
Revert migration, shared types, route module/registration, contract test, and doc/backlog changes in a single revert commit.
