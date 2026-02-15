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
