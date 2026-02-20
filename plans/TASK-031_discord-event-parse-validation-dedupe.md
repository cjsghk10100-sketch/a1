# TASK-031: Parse `@event` Line + Schema Validation + Dedupe

## 1) Problem
Discord raw ingest exists, but there is no normalized parser for `@event` command lines.
Without parsing + validation + dedupe, downstream automations cannot reliably consume message-driven control actions.

## 2) Scope
In scope:
- Add parsed-event storage table for Discord message lines.
- Parse `@event ...` lines from ingested message content.
- Validate payload schema for supported actions.
- Persist parse results (`valid|invalid`) with error codes.
- Ensure dedupe/idempotency for repeated parse attempts.
- Add API endpoint to parse an ingested message and list parsed lines.
- Add contract test for parse, validation, and dedupe.
- Update backlog.

Out of scope:
- Executing parsed commands into domain actions (approval decision wiring is TASK-032).
- Discord transport runtime/webhook bot process.

## 3) Constraints (Security/Policy/Cost)
- Parsing is data-only; do not execute external side effects.
- Validation must be deterministic and explicit.
- Repeated parse calls must not duplicate rows.
- Keep workspace scoping strict via `x-workspace-id`.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/discordIngest.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/032_discord_ingest.sql`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/discord.ts`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/033_discord_event_parse.sql`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_discord_event_parse.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Contract checks:
  - valid `@event` line is stored with `status=valid`.
  - invalid `@event` line is stored with `status=invalid` and parse error.
  - repeated parse on same ingest row reports dedupe and does not create duplicates.

## 6) Step-by-step plan
1. Add parsed-event schema/types.
2. Add migration for parsed-event rows + dedupe unique key.
3. Implement parser + schema validator in discord ingest route.
4. Add parse/list endpoints.
5. Add contract test and include in API test script.
6. Update backlog.

## 7) Risks & mitigations
- Risk: ambiguous parser grammar.
- Mitigation: strict `key=value` token format and explicit errors.
- Risk: duplicate parsed rows from retries.
- Mitigation: unique key `(workspace_id, ingest_id, line_index)` + conflict handling.

## 8) Rollback plan
Revert migration, parser/endpoint changes, shared type updates, contract test, and backlog updates in one revert commit.
