# Agent App

Monorepo layout:

- `apps/api/` backend API
- `apps/web/` web frontend
- `packages/shared/` shared code
- `infra/` local infra (Docker Compose)
- `docs/` specs and workflow docs
- `plans/` task plans

Start here:

- `docs/SPEC_v1_1.md`
- `docs/EVENT_SPECS.md`
- `BACKLOG.md`

## Local DB (Postgres)

Start:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Stop:

```bash
docker compose -f infra/docker-compose.yml down
```

If you already have something on port `5432`, change the port mapping in `infra/docker-compose.yml`.

## Migrations

With `DATABASE_URL` set:

```bash
pnpm -C apps/api db:migrate
pnpm -C apps/api db:status
```

## Desktop MVP (Electron)

Desktop mode is a local runtime wrapper (source + pnpm required).  
It does **not** build a DMG/installer in this stage.

1. Start Postgres:

```bash
docker compose -f infra/docker-compose.yml up -d
```

2. Run DB migrations:

```bash
pnpm -C apps/api db:migrate
```

3. Start desktop app (auto-starts API + embedded worker + web):

```bash
pnpm desktop:dev
```

Optional desktop env vars:

- `DESKTOP_API_PORT` (default `3000`)
- `DESKTOP_WEB_PORT` (default `5173`)
- `DESKTOP_API_START_TIMEOUT_MS` (default `45000`)
- `DESKTOP_WEB_START_TIMEOUT_MS` (default `45000`)
- `DESKTOP_RUNNER_MODE` (default `embedded`, allowed: `embedded|external`)
- `DESKTOP_ENGINE_WORKSPACE_ID` (default `ws_dev`, external mode only)
- `DESKTOP_ENGINE_ROOM_ID` (optional room filter, external mode only)
- `DESKTOP_ENGINE_ACTOR_ID` (default `desktop_engine`, external mode only)
- `DESKTOP_ENGINE_POLL_MS` (default `1200`, external mode only)
- `DESKTOP_ENGINE_MAX_CLAIMS_PER_CYCLE` (default `1`, external mode only)
- `DESKTOP_RESTART_MAX_ATTEMPTS` (default `5`)
- `DESKTOP_RESTART_BASE_DELAY_MS` (default `1000`)
- `DESKTOP_RESTART_MAX_DELAY_MS` (default `30000`)
- `DESKTOP_NO_WINDOW` (default `0`, smoke/headless mode)
- `DESKTOP_EXIT_AFTER_READY` (default `0`, smoke/one-shot mode)
- `VITE_DEV_API_BASE_URL` (optional override for web dev proxy target; desktop launcher auto-sets this to `http://127.0.0.1:${DESKTOP_API_PORT}`)

Examples:

```bash
# default (embedded worker)
pnpm desktop:dev

# external engine mode (desktop starts API+web+engine)
DESKTOP_RUNNER_MODE=external pnpm desktop:dev

# if 3000/5173 are already in use
DESKTOP_API_PORT=3301 DESKTOP_WEB_PORT=5174 pnpm desktop:dev
```

Profile shortcuts:

```bash
pnpm desktop:dev:embedded
pnpm desktop:dev:external
```

Use env template for stable local runs:

```bash
cp .env.desktop.example .env.desktop
pnpm desktop:dev:env
```

Desktop smoke checks (headless launcher verification):

```bash
# requires DATABASE_URL
pnpm -C apps/desktop run smoke:embedded
pnpm -C apps/desktop run smoke:external
```

Desktop packaging (macOS arm64, unsigned artifacts):

```bash
pnpm desktop:dist:mac
```

Packaging notes:

- Artifacts are produced in `apps/desktop/dist` (`.dmg`, `.zip`).
- Current package is unsigned/not notarized (local/internal distribution target).
- Desktop launcher still depends on local workspace source + pnpm runtime.

## Run Execution (Queued Runs)

Queued runs need a worker loop. Choose one mode:

1. API + standalone worker (recommended during development)

```bash
pnpm -C apps/api dev
pnpm -C apps/api runs:worker:watch
```

2. API with embedded worker

```bash
RUN_WORKER_EMBEDDED=1 pnpm -C apps/api dev
```

3. External engine runner (claim + execute loop)

```bash
pnpm -C apps/api dev
pnpm -C apps/engine dev
```

Optional engine env vars:

- `ENGINE_API_BASE_URL` (default `http://127.0.0.1:3000`)
- `ENGINE_WORKSPACE_ID` (default `ws_dev`)
- `ENGINE_ROOM_ID` (optional; when set, only claims queued runs from that room)
- `ENGINE_ACTOR_ID` (default `external_engine`)
- `ENGINE_POLL_MS` (default `1200`)
- `ENGINE_MAX_CLAIMS_PER_CYCLE` (default `1`)
- `ENGINE_RUN_ONCE` (default `false`)

Debugging claim endpoint directly:

```bash
# claim one queued run (workspace scope, optional room_id filter)
curl -sS -X POST http://localhost:3000/v1/runs/claim \
  -H "content-type: application/json" \
  -H "x-workspace-id: ws_dev" \
  -d '{"actor_id":"engine_bridge"}'
```

Claimed runs can be executed by your external engine via existing run/step/tool/artifact endpoints.

Optional tuning:

- `RUN_WORKER_POLL_MS` (default `1000`)
- `RUN_WORKER_BATCH_LIMIT` (unset = default worker batch)
- `RUN_WORKER_WORKSPACE_ID` (unset = all workspaces)

## Secrets Vault (Optional)

`SECRETS_MASTER_KEY` is only required for the secrets-vault endpoints:

- `POST /v1/secrets`
- `GET /v1/secrets`
- `POST /v1/secrets/:id/access`

If the key is not set, API/server startup and existing endpoints still work; vault endpoints return `501`.
