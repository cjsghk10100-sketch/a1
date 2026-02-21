# TASK-222: Contract Discord Parse/Emoji Re-run Isolation (Unique IDs)

## 1) Problem
`contract_discord_event_parse.ts` and `contract_discord_emoji_mapping.ts` use fixed Discord IDs.
On reruns against a shared local DB, dedupe tables can treat “first ingest/reaction” as already seen,
causing status assertions to fail (`200 !== 201`).

## 2) Scope
In scope:
- Make parse contract use per-run unique guild/channel/message ids.
- Make emoji mapping contract use per-run unique channel/source/reaction ids.
- Preserve same semantic checks for dedupe behavior inside a single run.

Out of scope:
- API endpoint behavior changes
- DB schema/migration changes
- Other unrelated contract refactors

## 3) Constraints (Security/Policy/Cost)
- Keep tests deterministic within one execution.
- Keep identifiers ASCII-safe.
- Minimal, test-only changes.

## 4) Repository context
Files to update:
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_discord_event_parse.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_discord_emoji_mapping.ts`

New files:
- `/Users/min/Downloads/에이전트 앱/plans/TASK-222_contract-discord-parse-emoji-unique-ids.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` passes.
- Full API contracts progress past discord parse/emoji stages without first-call dedupe regression.

## 6) Step-by-step plan
1. Add per-run suffix in both contracts.
2. Replace hard-coded Discord IDs with generated variables.
3. Keep duplicate requests within each test reusing same generated IDs (to preserve dedupe assertions).
4. Run typecheck + full API contracts.

## 7) Risks & mitigations
- Risk: missing one fixed ID leaves residual collision.
  - Mitigation: grep for old constants (`chan_parse`, `msg_parse_1`, `chan_emoji`, `discord_msg_*`).
- Risk: over-randomization breaks deterministic assertions.
  - Mitigation: generate once and reuse across each test's request chain.

## 8) Rollback plan
Revert both test files and this plan file in one commit.
