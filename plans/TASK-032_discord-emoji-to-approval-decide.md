# TASK-032: CEO Emoji Reply Mapping to `approval.decided`

## 1) Problem
Discord ingest + `@event` parsing exist, but CEO emoji replies are not connected to approval decisions.
Without mapping, operational approval actions from Discord cannot drive `approval.decided`.

## 2) Scope
In scope:
- Add API endpoint to map emoji reply into approval decision.
- Resolve target approval from parsed `approval.requested` line on replied Discord message.
- Append `approval.decided` event and apply approval projector.
- Add idempotent dedupe for repeated processing of same emoji message id.
- Add contract test for approve/deny/hold mapping path.
- Update backlog.

Out of scope:
- Discord webhook/bot transport runtime.
- Complex thread/reaction history sync.

## 3) Constraints (Security/Policy/Cost)
- Decision mapping only for known emoji set (`approve|deny|hold`).
- Mapping must be workspace-scoped.
- Reprocessing same Discord emoji message id must be idempotent.
- No bypass of approval projection logic.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/discordIngest.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/projectors/approvalProjector.ts`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/discord.ts`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/034_discord_emoji_decisions.sql`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_discord_emoji_mapping.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` passes.
- Contract checks:
  - emoji reply maps to expected decision and updates approval projection.
  - same emoji message id processed twice returns dedupe behavior and does not duplicate decision events.

## 6) Step-by-step plan
1. Add shared request/response types for emoji decision mapping.
2. Add dedupe table for processed emoji decision messages.
3. Implement emoji decision mapping endpoint.
4. Add contract test and include in API test chain.
5. Update backlog.

## 7) Risks & mitigations
- Risk: wrong target approval selected.
- Mitigation: resolve strictly from replied Discord message’s parsed `approval.requested` payload.
- Risk: duplicate approvals from retry.
- Mitigation: unique key on `(workspace_id, discord_message_id)` with conflict dedupe.

## 8) Rollback plan
Revert migration, route additions, shared type updates, contract test, and backlog update in one revert commit.
