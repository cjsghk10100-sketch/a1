# Backup / Recovery Runbook (Postgres)

## Scope
- Event store (`evt_events`) + projections + security tables
- Local/desktop 운영 기준 최소 경로

## Preconditions
- `DATABASE_URL` set
- `pg_dump`, `psql`, `pg_restore` available
- Keep secrets out of shell history when possible

## 1) Backup (logical dump)

```bash
pg_dump "$DATABASE_URL" -Fc -f backup_$(date +%Y%m%d_%H%M%S).dump
```

Recommended periodic check:

```bash
pg_restore -l backup_YYYYMMDD_HHMMSS.dump | head
```

## 2) Restore (new DB)

1. Create target DB:

```bash
createdb agentapp_restore
```

2. Restore dump:

```bash
pg_restore -d "postgres://<user>@<host>/agentapp_restore" backup_YYYYMMDD_HHMMSS.dump
```

3. Run post-restore validation:

```bash
DATABASE_URL='postgres://<user>@<host>/agentapp_restore' pnpm -C apps/api audit:verify-chain
DATABASE_URL='postgres://<user>@<host>/agentapp_restore' pnpm -C apps/api test
```

## 3) Hash-chain Integrity Batch

Verify all streams:

```bash
DATABASE_URL="$DATABASE_URL" pnpm -C apps/api audit:verify-chain
```

Verify a specific stream:

```bash
STREAM_TYPE=room STREAM_ID=room_... DATABASE_URL="$DATABASE_URL" pnpm -C apps/api audit:verify-chain
```

## 4) Secrets Master Key Rotation Path

This path re-encrypts `sec_secrets` values in place.

```bash
CURRENT_SECRETS_MASTER_KEY='old-key' \
NEXT_SECRETS_MASTER_KEY='new-key' \
DATABASE_URL="$DATABASE_URL" \
pnpm -C apps/api secrets:rotate-key
```

Optional workspace-scoped rotation:

```bash
WORKSPACE_ID=ws_dev \
CURRENT_SECRETS_MASTER_KEY='old-key' \
NEXT_SECRETS_MASTER_KEY='new-key' \
DATABASE_URL="$DATABASE_URL" \
pnpm -C apps/api secrets:rotate-key
```

After rotation:
1. Update runtime env to new key.
2. Re-run secret access smoke.
3. Run hash-chain verification.

## 5) Minimal Recovery Decision Flow

1. Service unstable -> restore latest verified dump to fresh DB.
2. Run `audit:verify-chain`.
3. Run API contract tests.
4. Switch app `DATABASE_URL` to restored DB.
5. Monitor `/health`, desktop runtime badge, and `/ops` lease/quarantine signals.
