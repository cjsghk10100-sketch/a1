# TASK-406: App Min Patches for Pipeline Sync Adapter (v0.1)

## Problem
- Sync Adapter(v0.1, render-only)가 폴더 렌더를 안정적으로 하기 위한 단일 projection API가 필요하다.
- Drift/Watcher 재시도 시 incident 중복 생성이 발생할 수 있어 idempotent open 계약이 필요하다.

## Scope
In scope:
- `GET /v1/pipeline/projection` 추가 (fixed 6-stage snapshot, stable sort, minimal fields).
- `POST /v1/incidents`에 `idempotency_key` 수용 + duplicate key 요청 시 `200 deduped=true`.
- 계약 테스트 추가:
  - `contract_pipeline_projection.ts`
  - `contract_incidents.ts` idempotency 시나리오 보강
- API 테스트 체인에 신규 계약 테스트 연결.
- 문서 동기화(`docs/SPEC_v1_1.md`, `docs/EVENT_SPECS.md`).

Out of scope:
- DB schema 변경.
- 이벤트 소싱 모델/append-only 구조 변경.
- pipeline stage 의미 확장(v0.1 예약 stage 채우기).

## API Contract
### GET `/v1/pipeline/projection`
- Query: `limit` (default `200`, max `500`)
- Always returns:
  - `schema_version = "pipeline_projection.v0.1"`
  - `generated_at` (RFC3339)
  - Stage keys (always present):  
    `1_inbox`, `2_pending_approval`, `3_execute_workspace`, `4_review_evidence`, `5_promoted`, `6_demoted`
- Stage mapping:
  - `2_pending_approval`: `proj_approvals.status IN ('pending','held')`
  - `3_execute_workspace`: `proj_runs.status IN ('queued','running')`
  - `4_review_evidence`: `proj_runs.status IN ('succeeded','failed')`
  - `1/5/6`: 빈 배열
- Sorting:
  - `updated_at DESC`, `entity_id ASC`
- Churn guard:
  - `lease_heartbeat_at`, `lease_expires_at`, `claim_token`, `claimed_by_actor_id` 제외

### POST `/v1/incidents`
- Request: optional `idempotency_key` (trimmed, 1..200)
- First insert:
  - `201 { incident_id, deduped:false }`
- Duplicate idempotency key:
  - `200 { incident_id, deduped:true }`
- If unique conflict occurred but prior event lookup fails:
  - `409 { error:"idempotency_conflict_unresolved" }`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Contract checks:
  - projection 응답 6 stage key 고정 + 정렬 고정 + lease 필드 미노출
  - incident duplicate key가 동일 incident_id로 수렴하고 `evt_events`는 단건

## Risks / Mitigations
- Risk: projection payload churn.
  - Mitigation: minimal fields + stable sort + volatile lease fields exclude.
- Risk: duplicate incident retries causing noisy alerts.
  - Mitigation: DB unique + `23505` catch + idempotent 200 response.

## Rollback
- `pipeline.ts` 및 라우트 등록 제거.
- incident idempotency 분기 제거.
- 관련 계약 테스트 제거.
- 문서 변경 revert.
