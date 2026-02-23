# TASK-307: External Engine Optional Room Scope (`ENGINE_ROOM_ID`)

## 1) Problem
External engine currently claims queued runs by workspace scope only.  
In multi-room operation, a single runner can unintentionally process runs from unrelated rooms.

## 2) Scope
In scope:
- Add optional `ENGINE_ROOM_ID` env to engine runner.
- Pass `room_id` to `POST /v1/runs/claim` when configured.
- Add desktop pass-through env `DESKTOP_ENGINE_ROOM_ID` for external mode.
- Update README docs.

Out of scope:
- API route contract changes (already supports optional `room_id`).
- New permission logic.
- Multi-room scheduling strategies.

## 3) Constraints (Security/Policy/Cost)
- Keep existing policy/approval gates unchanged.
- Do not broaden claim scope by default.
- No dependency additions.

## 4) Repository context
Existing relevant files:
- `/Users/min/Downloads/에이전트 앱/apps/engine/src/index.ts`
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`
- `/Users/min/Downloads/에이전트 앱/README.md`

## 5) Acceptance criteria (observable)
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
4. Manual:
   - Set `ENGINE_ROOM_ID=<room_id>` and confirm only that room’s queued runs are claimed.

## 6) Step-by-step plan
1. Extend engine config with optional `roomId`.
2. Include `room_id` in claim payload when provided.
3. Wire desktop env pass-through for external mode.
4. Document env vars in README.
5. Run validation commands.

## 7) Risks & mitigations
- Risk: typo room id causes “no runs claimed”.
  - Mitigation: keep room filter optional and log startup config clearly.

## 8) Rollback plan
Revert changes in:
- `/Users/min/Downloads/에이전트 앱/apps/engine/src/index.ts`
- `/Users/min/Downloads/에이전트 앱/apps/desktop/src/main.cjs`
- `/Users/min/Downloads/에이전트 앱/README.md`
