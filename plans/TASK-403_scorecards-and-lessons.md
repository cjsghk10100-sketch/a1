# TASK-403: Scorecards + Lessons (numeric, reproducible evaluation + learning output)

## 1) Problem
Evidence may exist but there is no standardized numeric evaluation object (scorecard) and no generalized lesson record outside incident-only learning.

## 2) Scope
In scope:
- events: `scorecard.recorded`, `lesson.logged`
- projections: `proj_scorecards`, `proj_lessons`
- API:
  - `POST /v1/scorecards`
  - `GET /v1/scorecards`
  - `GET /v1/scorecards/:scorecardId`
  - `POST /v1/lessons`
  - `GET /v1/lessons`
- deterministic `metrics_hash` (sorted canonical metrics)
- deterministic score/decision rule:
  - weighted average score in `[0,1]`
  - pass >= 0.75, warn >= 0.5, fail otherwise
- contract test `apps/api/test/contract_scorecards_lessons.ts`

Out of scope:
- automatic score derivation from evidence
- UI dashboards

## 3) Constraints
- metrics values must be numeric
- duplicate metric keys rejected
- no unused tables (write + read + tests required)
- DLP/redaction remains enforced through event store write path

## 4) Schema
Migration `041_scorecards_lessons.sql`:
- `proj_scorecards` (scorecard identity, references, template key/version, metrics, hash, score, decision, rationale, metadata, actor, timestamps)
- `proj_lessons` (lesson identity, optional refs to experiment/run/scorecard/incident, category, summary, actions, tags, metadata, actor, timestamps)

## 5) Edge cases
- template requiring evidence:
  - reject if evidence missing, unless explicit manual justification metadata is provided (controlled template path)
- lesson must link to at least one context:
  - experiment/run/scorecard/incident

## 6) Acceptance
- scorecards/lessons can be written and read
- metrics order does not affect `metrics_hash`
- contract tests pass

## 7) Risks
- metric fragmentation:
  - mitigated by template key/version + canonical metric schema
- secret leakage in rationale/lesson text:
  - mitigated by appendToStream DLP checks + contract assertions

## 8) Rollback
- revert PR
- reset envs can drop new projection tables
