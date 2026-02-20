# BACKLOG (Codex-ready)

## Conventions
- Each task: ~1 hour / few hundred LOC
- Each task produces 1 PR
- Start with plan file in /plans (Ask mode), then implement (Code mode)
- Detailed implementation history and extended tasks are tracked in `/plans` (TASK-099+).

---

## MVP-0: Repo + Dev Environment
- [x] TASK-001 Repo bootstrap (monorepo layout + pnpm + basic CI)
- [x] TASK-002 Infra: postgres docker-compose + env example
- [x] TASK-003 Migration runner + first migration folder scaffold

## MVP-1: Event store + projections foundation
- [x] TASK-010 Create evt_events + evt_stream_heads (+ indexes)
- [x] TASK-011 Create proj_projectors + applied_events idempotency table
- [x] TASK-012 Minimal projections: rooms/threads/messages tables + projector skeleton

## MVP-2: Policy gate + approvals (MIN_ORG core)
- [x] TASK-020 Policy decision engine (ALLOW/DENY/REQUIRE_APPROVAL + reason_code)
- [x] TASK-021 Approvals tables + API endpoints (request/decide)
- [x] TASK-022 Kill-switch flag + enforcement

## MVP-3: Discord ingest normalization (optional if OpenClaw does gateway)
- [ ] TASK-030 integ_discord_messages + channel mapping table
- [ ] TASK-031 Parse @event line + schema validation + dedupe
- [ ] TASK-032 CEO emoji reply mapping to approval.decided

## MVP-4: Web UI skeleton (CEO mode first)
- [x] TASK-040 Web scaffold + i18n (en/ko) wiring
- [x] TASK-041 CEO Approval Inbox (pending/held/decided + decision actions)
- [x] TASK-042 Notifications stream UI (unread/read)

## MVP-5: Work Surface essentials
- [x] TASK-050 Pins (message/thread/artifact/run/memory) + UI
- [x] TASK-051 Search (pg_trgm) + UI
- [x] TASK-052 Run inspector timeline (run/steps/toolcalls/artifacts)

## MVP-6: Learn or Die + Sustain or Sunset
- [x] TASK-060 Incidents + RCA + close blockers
- [x] TASK-061 Survival ledgers + daily rollup
- [ ] TASK-062 Lifecycle automation (ACTIVE→PROBATION→…)
