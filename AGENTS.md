# MIN_ORG Agent Activity App (Codex Instructions)

## Goal
Build a lightweight, agent-first workspace (Discord-light) optimized for:
- event-sourced observability (append-only)
- approvals + policy gate (Request != Execute)
- learning enforcement (RCA + Learning Ledger)
- survival scoring (Sustain or Sunset)
- bilingual UI (EN + KO)

## Non-negotiables (MIN_ORG)
1) Security First
- Never bypass auth/policy gates.
- Never weaken audit trails. Event log is append-only.
- Never log secrets. Always redact tokens/keys/PII.

2) Request != Execute
- Any external write, OAuth/key changes, cron changes, permissions, wallet/funds: REQUIRE approval.
- If unsure: create an approval request instead of executing.

3) Learn or Die
- Any failure must produce RCA + Learning Ledger entry before “close”.

4) Sustain or Sunset
- Costs must be tracked; value/learning must be visible.
- If features are expensive, implement budget caps and “cheap-by-default”.

## Working agreements for Codex
- Start every medium/large change with a plan in /plans or update /PLANS.md first (Ask mode).
- Keep each PR small (target: ~1 hour / a few hundred LOC).
- Prefer explicit file paths and observable acceptance checks (commands + expected outputs).
- Do not add new production dependencies without writing a short justification in the PR.

## Repo conventions (expected)
- All UI strings go through i18n keys (EN + KO required).
- Event types and payload schemas must be defined in /docs/EVENT_SPECS.md and in code (shared package).
- Migrations are required for any DB changes; never mutate history.

## Local commands (update once scaffold exists)
- install: pnpm i
- dev: pnpm dev
- test: pnpm test
- lint: pnpm lint
- db: docker compose -f infra/docker-compose.yml up -d
- migrate: pnpm db:migrate

## PR Definition of Done (DoD)
- [ ] Code compiles + tests pass locally.
- [ ] Added/updated docs (SPEC/EVENT_SPECS/PLANS as needed).
- [ ] Bilingual UI keys present for any new user-facing string.
- [ ] No secrets in logs/config. .env.example updated if needed.
