# BACKLOG (Codex-ready)

## Conventions
- Each task: ~1 hour / few hundred LOC
- Each task produces 1 PR
- Start with plan file in /plans (Ask mode), then implement (Code mode)
- Detailed implementation history and extended tasks are tracked in `/plans` (TASK-099+).

---

## Now Work (Post-PR18G Release Stabilization)
- [x] RLS-001 a2 bridge E2E baseline lock (eg1) — 2026-03-05 PASS
  - `bash /Users/min/Downloads/a2/mvp/scripts/quality_gate.sh`
  - `bash /Users/min/Downloads/a2/mvp/scripts/e2e_evidence_ingest.sh` (`APP_DATABASE_URL` = `/Users/min/Downloads/agent/.env.desktop` `DATABASE_URL`)
  - `bash /Users/min/Downloads/a2/mvp/scripts/e2e_agentapp_bridge_worker.sh`
  - evidence: `/Users/min/Downloads/a2/mvp/evidence/e2e_agentapp_bridge_worker_20260305_164445.md`
- [x] RLS-002 a1 release docs/runbook alignment — 2026-03-05 PASS
  - target: `README.md`, `docs/SYSTEM_HEALTH_v0_2.md`, `docs/KERNEL_CHANGE_PROTOCOL.md`, `docs/ENGINE_APP_VERSION_MATRIX.md`
  - rule: no API/schema/event/reason_code changes
- [x] RLS-003 a1 release gate rerun — 2026-03-05 PASS
  - `bash /Users/min/Downloads/agent/scripts/e2e_engine_app_smoke.sh`
  - `bash /Users/min/Downloads/agent/scripts/e2e_engine_app_live_probe.sh`
- [x] RLS-004 baseline SHA sync + push (a1/a2) — 2026-03-05 PASS
  - update `docs/ENGINE_APP_VERSION_MATRIX.md` with validated pair
- [x] RLS-005 release closeout note fixed — 2026-03-06 PASS
  - `docs/RELEASE_CLOSEOUT_2026-03-06.md`
  - gate bundle: `/tmp/release_closeout_20260306_005617`

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
- [x] TASK-030 integ_discord_messages + channel mapping table
- [x] TASK-031 Parse @event line + schema validation + dedupe
- [x] TASK-032 CEO emoji reply mapping to approval.decided

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
- [x] TASK-062 Lifecycle automation (ACTIVE→PROBATION→…)

## Desktop Runtime Hardening
- [x] TASK-323 Desktop runtime supervisor + global degraded badge
- [x] TASK-324 Desktop packaging baseline (macOS arm64 zip/dmg)
- [x] TASK-325 Run claim lease/heartbeat stabilization
- [x] TASK-326 Desktop smoke automation (embedded/external)
- [x] TASK-327 Docs sync and contract freeze
