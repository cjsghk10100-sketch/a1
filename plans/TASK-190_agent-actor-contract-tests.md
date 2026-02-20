# TASK-190: Agent Actor Contract Test Coverage

## 1) Problem
- `agent` actor 타입을 코드/스키마에 확장했지만, 계약 테스트에서 해당 경로를 직접 검증하지 않는다.
- 회귀 시 `agent` 지원이 조용히 깨질 위험이 있다.

## 2) Scope
In scope:
- `contract_principals.ts`에 `actor_type=agent` ensure 케이스 추가
- `contract_approvals.ts`에 `actor_type=agent` 요청 생성/투영 검증 추가

Out of scope:
- 런타임 로직 변경
- API 스펙 변경

## 3) Constraints (Security/Policy/Cost)
- 테스트만 보강하고 기존 동작은 변경하지 않는다.
- 기존 테스트 시나리오와 독립적으로 실행되도록 데이터 분리한다.

## 4) Repository context
- Existing files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_principals.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_approvals.ts`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 테스트에서 agent actor principal_type이 `agent`로 검증됨

## 6) Step-by-step plan
1. principals contract에 `actor_type: "agent"` ensure + idempotent 확인 추가.
2. approvals contract에 `actor_type: "agent"` 생성 케이스 추가 후 projection row 검증.
3. 타입체크 + 전체 API 테스트 실행.

## 7) Risks & mitigations
- Risk: 기존 테스트 기대 개수(rowCount)가 변경될 수 있음.
- Mitigation: 신규 assertion은 독립 조건(approval_id, actor_type)으로 추가한다.

## 8) Rollback plan
- 테스트 파일 변경만 되돌리면 런타임 영향 없이 복구 가능.
