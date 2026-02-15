# TASK-002 Infra: Postgres docker-compose + env examples

## 1) Problem
Local dev needs a consistent Postgres instance for event store/projections.

## 2) Scope
In scope:
- Add/adjust docker-compose for Postgres (+ healthcheck)
- Update root `.env.example` (created in TASK-001) with `DATABASE_URL` matching compose defaults
- Add minimal docs in README

Out of scope:
- Migrations, schema, API usage

## 3) Constraints
- No secrets committed
- Use standard Postgres image, persist volume

## 4) Repository context
Add:
- /infra/docker-compose.yml
- Update `/.env.example` (root)
- (Optional) add `/apps/api/.env.example` if API service needs app-specific env docs later

## 5) Acceptance criteria
- `docker compose -f infra/docker-compose.yml up -d` starts Postgres
- `docker compose -f infra/docker-compose.yml ps` shows healthy
- `/.env.example` contains `DATABASE_URL` matching compose ports/credentials/db name

## 6) Steps
1) Create docker-compose.yml:
   - service: postgres:16
   - ports: 5432:5432
   - env: POSTGRES_USER/POSTGRES_PASSWORD/POSTGRES_DB
   - healthcheck: pg_isready
   - volume: pgdata
2) Update `/.env.example` with:
   - DATABASE_URL=postgres://agentapp:agentapp@localhost:5432/agentapp
3) Add README section:
   - start db
   - stop db

## 7) Risks
- Port conflict on 5432
  - Mitigation: document how to change port

## 8) Rollback
Revert infra files.
