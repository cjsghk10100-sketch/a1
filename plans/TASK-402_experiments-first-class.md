# TASK-402: Experiments (first-class object above runs)

## 1) Problem
Runs exist, but experiments are not first-class:
- no hypothesis/success criteria/stop conditions/budget wrapper above runs.

## 2) Scope
In scope:
- events: `experiment.created`, `experiment.updated`, `experiment.closed`
- projection: `proj_experiments`
- additive nullable `experiment_id` on `proj_runs`
- API:
  - `POST /v1/experiments`
  - `GET /v1/experiments`
  - `GET /v1/experiments/:experimentId`
  - `POST /v1/experiments/:experimentId/update`
  - `POST /v1/experiments/:experimentId/close`
- run linkage:
  - `POST /v1/runs` optional `experiment_id`
  - `GET /v1/runs` optional `experiment_id` filter
- contract test `apps/api/test/contract_experiments.ts`

Out of scope:
- portfolio object above experiments
- UI

## 3) Constraints
- additive only; keep `run.*` semantics unchanged
- room-scoped experiment events append to room stream
- close rule:
  - default reject close when queued/running runs exist
  - allow `force=true` with explicit reason

## 4) Schema
Migration `040_experiments.sql`:
- `proj_experiments` with status (`open|closed|stopped`), hypothesis, criteria, stop conditions, budget, risk tier, metadata, actor, timestamps, correlation, last event.
- `proj_runs.experiment_id TEXT NULL` + workspace/experiment index.

## 5) Acceptance
- experiment lifecycle projected/queryable
- optional run linkage preserved and backward compatible
- contract tests pass

## 6) Risks
- client non-adoption of experiment linkage:
  - mitigated by optional field and backward compatibility
- criteria payload drift:
  - mitigated by fixed top-level keys + validation

## 7) Rollback
- revert PR
- nullable run column is harmless if left in reset envs
