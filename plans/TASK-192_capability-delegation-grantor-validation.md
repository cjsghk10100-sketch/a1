# TASK-192: Capability Delegation Grantor Validation

## 1) Problem
- 현재 `parent_token_id` 기반 delegation에서 `granted_by_principal_id`가 부모 토큰의 소유자(issued_to)인지 검증하지 않는다.
- 이로 인해 제3자가 부모 토큰을 참조해 임의 delegation을 시도할 수 있는 권한 경계 취약점이 생긴다.

## 2) Scope
In scope:
- `/v1/capabilities/grant`에서 principal 존재성 검증 추가
- parent delegation 시 `granted_by_principal_id === parent.issued_to_principal_id` 강제
- 위반 시 `agent.delegation.attempted` 이벤트 기록 + 에러 반환
- contract test에 실패 케이스 추가

Out of scope:
- DB 스키마 변경
- capability UI/visualization 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 정상 grant/delegation 경로는 유지
- 실패 케이스는 5xx가 아니라 4xx로 명확히 반환
- denied_reason은 이벤트에서 추적 가능해야 함

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/capabilities.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_capabilities.ts`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- contract에서 다음이 검증됨:
  - 없는 principal로 grant 시 400
  - parent owner와 다른 grantor로 delegation 시 403 + `agent.delegation.attempted` 기록

## 6) Step-by-step plan
1. capability grant 진입 시 issued_to/granted_by principal 존재성 검사 추가.
2. parent token 조회 필드 확장 후 grantor-owner 일치 검사 추가.
3. mismatch 시 delegation attempted 이벤트 기록 후 403 반환.
4. contract_capabilities에 실패 경로 assertions 추가.
5. 타입체크 + 전체 API 계약 테스트 실행.

## 7) Risks & mitigations
- Risk: 기존 테스트가 새 4xx 반환으로 깨질 수 있음.
- Mitigation: 기존 성공 경로는 유지하고 신규 실패 시나리오만 추가 검증한다.

## 8) Rollback plan
- capabilities route 및 contract test 변경을 되돌리면 즉시 기존 동작으로 복구 가능.
