# TASK-005 API skeleton (Fastify + pg pool + health)

## 1) Problem
We need a minimal API app that:
- boots reliably
- connects to Postgres
- provides /health
This is the base for event store and projections.

## 2) Scope
In scope:
- Fastify server with TypeScript
- Config loader (PORT, DATABASE_URL)
- Postgres pool module
- GET /health returns { ok: true }

Out of scope:
- Event store tables, projectors, business endpoints

## 3) Constraints
- Do not log DATABASE_URL
- No secrets in responses
- Keep middleware minimal

## 4) Repository context
Add/modify:
- /apps/api/src/server.ts
- /apps/api/src/config.ts
- /apps/api/src/db/pool.ts
- /apps/api/src/routes/health.ts
- /apps/api/src/index.ts
- /apps/api/package.json scripts (dev/start/typecheck)

## 5) Acceptance criteria
- With DB up and env set:
  - `pnpm -C apps/api dev` starts server
  - `curl http://localhost:<PORT>/health` returns ok
- Typecheck passes

## 6) Steps
1) Add deps in apps/api: fastify, pg; dev: tsx
2) Implement config.ts (read env, validate minimal)
3) Implement db pool
4) Register route /health
5) Start server in index.ts

## 7) Risks
- Fastify TS types can be verbose
  - Mitigation: keep minimal route typings

## 8) Rollback
Revert API skeleton.
