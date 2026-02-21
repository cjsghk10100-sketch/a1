# TASK-221: Contract Discord Ingest Re-run Isolation (Unique IDs)

## 1) Problem
`apps/api/test/contract_discord_ingest.ts` uses fixed identifiers (`chan_1`, `guild_1`, `msg_100`).
When rerun against the same local test DB, ingest dedupe and mapping uniqueness can return `200`
on the first ingest call, breaking the expected `201` contract flow.

## 2) Scope
In scope:
- Generate per-run unique identifiers for discord guild/channel/message in the contract.
- Keep same semantic assertions (first ingest = created, second ingest = deduped).
- Verify full API contract chain reaches/passes the discord ingest stage without manual DB reset.

Out of scope:
- API route behavior changes
- Schema/migration changes
- Refactoring unrelated contract tests

## 3) Constraints (Security/Policy/Cost)
- Preserve current endpoint contract and assertions.
- Keep identifiers ASCII-safe and deterministic within a single test run.
- Minimal patch only in this test file.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_discord_ingest.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-221_contract-discord-ingest-unique-ids.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` no longer fails at discord ingest due first ingest status mismatch (`200 !== 201`).

## 6) Step-by-step plan
1. Add per-run suffix generator inside the test.
2. Replace hard-coded guild/channel/message ids and related assertions/queries with variables.
3. Re-run full API contract chain to confirm the previous discord-ingest failure is removed.

## 7) Risks & mitigations
- Risk: missing one hard-coded identifier leaves partial collision.
  - Mitigation: grep for previous constants (`chan_1`, `guild_1`, `msg_100`) after edit.
- Risk: changed ids break in-test duplicate assertion path.
  - Mitigation: keep duplicate call reusing the same generated `messageId`.

## 8) Rollback plan
Revert this test file and the plan file in one revert commit.
