# TASK-178: Auto Quarantine on Repeated Blocked Violations

## 1) Problem
현재 에이전트 격리는 수동 API 호출에만 의존한다. 정책 위반이 반복되는 에이전트에 대해 자동 안전장치가 없어, 운영자가 놓치면 같은 실패가 계속 발생할 수 있다.

## 2) Scope
In scope:
- `learning.from_failure` 기록 흐름에서, 에이전트 principal로 식별 가능한 주체가 같은 정책 위반 패턴을 반복하고 실제로 block된 경우 자동 격리.
- 격리 성공 시 기존 이벤트 타입 `agent.quarantined`를 append.
- 계약 테스트에 자동 격리 케이스 추가.

Out of scope:
- 새로운 API 엔드포인트 추가
- trust score 산식 변경
- quarantine 정책 UI 변경

## 3) Constraints (Security/Policy/Cost)
- Request != Execute 경계를 우회하지 않는다.
- 이벤트 로그는 append-only 유지 (기존 `appendToStream` 사용).
- 자동 격리는 보수적으로 동작:
  - agent principal이 식별되는 경우만
  - `blocked=true` + 반복 임계치(>=3) 충족 시
  - 이미 격리 상태면 중복 이벤트 생성 금지

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/security/learningFromFailure.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_learning_constraints.ts`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api exec tsx test/contract_learning_constraints.ts` 통과
- 테스트에서 3회 반복 block 후 `sec_agents.quarantined_at`이 채워지고 `agent.quarantined` 이벤트가 생성됨을 확인

## 6) Step-by-step plan
1. `learningFromFailure`에 자동 격리 helper 추가 (조건 판정 + DB update + 이벤트 append).
2. `repeat_count` 계산 이후 임계치 충족 시 helper 호출.
3. 계약 테스트에 agent principal 기반 반복 위반 시나리오를 추가해 자동 격리를 검증.
4. 타입체크 + 대상 계약테스트 실행.

## 7) Risks & mitigations
- Risk: 과도한 자동 격리(오탐)
- Mitigation: 조건을 `agent principal + blocked + repeat_count>=3`로 제한, 이미 격리된 경우 무시.
- Risk: 동시성 중복 이벤트
- Mitigation: `UPDATE ... WHERE quarantined_at IS NULL`로 단일 성공만 허용.

## 8) Rollback plan
- `/apps/api/src/security/learningFromFailure.ts`의 auto-quarantine helper 호출 제거.
- `/apps/api/test/contract_learning_constraints.ts`의 관련 테스트 블록 제거.
