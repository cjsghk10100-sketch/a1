# TASK-003 Minimal SQL migration runner (no heavy deps)

## 1) Problem
We need a lightweight, deterministic migration runner for Postgres.
Avoid Prisma/Knex unless necessary.

## 2) Scope
In scope:
- Add migration folder and runner script that applies .sql files in order
- Add schema_migrations table
- Add scripts: db:migrate, db:status

Out of scope:
- Actual schema migrations (event store tables come later)

## 3) Constraints
- Append-only philosophy: migrations must be additive
- Runner must be idempotent
- No secrets in logs (do not print DATABASE_URL)

## 4) Repository context
Add/modify:
- /apps/api/migrations/000_schema_migrations.sql (optional bootstrap)
- /apps/api/scripts/migrate.ts
- /apps/api/scripts/migrate_status.ts
- /apps/api/package.json scripts
- root package.json script alias (optional)

## 5) Acceptance criteria
- With Postgres running and DATABASE_URL set:
  - `pnpm -C apps/api db:migrate` applies migrations and creates schema_migrations
  - `pnpm -C apps/api db:status` lists applied and pending migrations

## 6) Steps
1) In apps/api, add dependencies: `pg` and dev `tsx` (or equivalent)
2) Implement migrate.ts:
   - connect to DB
   - ensure schema_migrations(version text pk, applied_at timestamptz)
   - read /apps/api/migrations/*.sql sorted
   - for each file not in schema_migrations: run in transaction, then insert version
3) Implement migrate_status.ts:
   - read applied versions
   - diff with filesystem list
4) Wire scripts:
   - db:migrate, db:status
5) Add docs in /README.md

## 7) Risks
- Migrations partially applied if crash
  - Mitigation: per-file transaction

## 8) Rollback
Revert runner scripts; DB changes are only schema_migrations table.
