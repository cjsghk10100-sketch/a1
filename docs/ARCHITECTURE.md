# Architecture Skeleton (Bootstrap)

## Monorepo layout
- `apps/api`: policy gate, approval flow orchestration, event append/read APIs.
- `apps/web`: operator UI (EN/KO), approval inbox, survival/incidents views.
- `packages/shared`: shared event types and constants.
- `infra`: local dependencies (e.g., postgres).

## Planned runtime model
1. API receives requests and evaluates policy decision (`ALLOW`, `DENY`, `REQUIRE_APPROVAL`).
2. Approved actions emit append-only events.
3. Projectors update read models idempotently.
4. Web reads projections and timeline feeds.

## Bootstrap status
This document is intentionally high-level and will be expanded during TASK-010+.
