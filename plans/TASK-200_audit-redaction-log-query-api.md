# TASK-200: Audit Redaction Log Query API

## 1) Problem
- redaction 탐지/요약은 `sec_redaction_log`에 기록되지만 운영자가 이를 API로 조회할 경로가 없다.
- 현재는 DB 직접 조회가 필요해 로컬 운영/감사 워크플로우가 끊긴다.

## 2) Scope
In scope:
- `/v1/audit/redactions` 조회 엔드포인트 추가
- workspace 범위 필터 + `event_id/rule_id/action/stream_type/stream_id/limit` 필터 지원
- `contract_secrets.ts`에 redaction API 조회 검증 추가

Out of scope:
- Web UI 신규 화면
- redaction log 스키마 변경

## 3) Constraints (Security/Policy/Cost)
- workspace 경계 유지 (`x-workspace-id`)
- 조회 API는 읽기 전용, 기존 이벤트/로그 저장 로직 변경 없음
- 쿼리 제한(`limit`)으로 과도 조회 방지

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/audit.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_secrets.ts`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-200_audit-redaction-log-query-api.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- `contract_secrets`에서 leak 발생 후 `/v1/audit/redactions?event_id=<source_event_id>`가 200 + row 반환

## 6) Step-by-step plan
1. `audit.ts`에 redaction log 조회용 query 파라미터 파서 추가.
2. `/v1/audit/redactions` GET 구현.
3. `contract_secrets.ts`에서 endpoint 응답 검증 추가.
4. 타입체크/계약 테스트 실행.

## 7) Risks & mitigations
- Risk: 필터 조합 실수로 타 workspace 로그가 노출될 수 있음.
- Mitigation: SQL 첫 조건을 `workspace_id = $1`로 고정하고 나머지 필터는 optional로만 추가.

## 8) Rollback plan
- `audit.ts` 신규 endpoint와 계약 테스트 블록만 revert하면 기존 동작으로 즉시 복귀.
