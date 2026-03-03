# TASK-419 Ops Dashboard Standalone Web App v0 (PR-20B)

## Goal
- Add standalone dashboard app consuming:
  - `POST /v1/system/health`
  - `GET /v1/system/health/issues`
  - `POST /v1/finance/projection`
- Keep read-only behavior and ops-safe polling discipline.

## Scope
- New app under `apps/ops-dashboard`.
- React + TypeScript + Vite + Tailwind + recharts.
- Typed API client (`never throw` policy).
- Polling hooks with hidden-tab pause + in-flight guard.
- Drilldown on-demand with pagination.
- Unit tests T1~T23 (API, hooks, components, formatting, routing, workspace/data-export flows).

## Non-goals
- No API/engine changes.
- No auth UI or user management.
- No write operations.
- No WebSocket.

## Acceptance
- `pnpm -C apps/ops-dashboard test` passes.
- `pnpm -C apps/ops-dashboard typecheck` passes.
- `pnpm -C apps/ops-dashboard build` passes.
- Baseline dashboard renders health/finance/drilldown and handles stale/error paths.
