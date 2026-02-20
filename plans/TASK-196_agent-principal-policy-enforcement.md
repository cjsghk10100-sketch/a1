# TASK-196: Agent Principal Binding Enforcement in Policy Gate

## 1) Problem
- `actor_type="agent"` 요청에서 `principal_id`가 없어도 정책 평가가 진행된다.
- principal과 actor_id의 결속 검증이 없어 에이전트 신원 스푸핑 위험이 남아 있다.

## 2) Scope
In scope:
- Policy gate authorize 경로에 agent principal binding 검사 추가
- 검사 실패 reason_code 표준화:
  - `agent_principal_required`
  - `agent_principal_not_found`
  - `agent_actor_id_mismatch`
- contract test로 deny/allow 경로 검증 추가

Out of scope:
- approvals/create 등 비-policy 엔드포인트의 actor 입력 계약 변경
- principal 생성/회전 로직 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 user/service actor 정책 동작은 그대로 유지
- 실패는 5xx가 아닌 정책 결정(`deny`)으로 반환
- 이벤트/학습 파이프라인은 기존 authorize 흐름을 그대로 타야 함

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_policy_enforcement.ts`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-196_agent-principal-policy-enforcement.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- contract에서 아래 확인:
  - agent actor + principal 없음 => deny / `agent_principal_required`
  - agent actor + 존재하지 않는 principal => deny / `agent_principal_not_found`
  - agent actor + principal 불일치 actor_id => deny / `agent_actor_id_mismatch`
  - agent actor + principal/actor_id 일치 => 정상 allow

## 6) Step-by-step plan
1. authorize core 앞단에 agent principal binding 검사 함수 추가.
2. 검사 실패 시 기존 deny 이벤트/learning 기록 흐름을 재사용.
3. contract_policy_enforcement에 검증 케이스 추가.
4. 타입체크 + 전체 API 계약 테스트 실행.

## 7) Risks & mitigations
- Risk: 기존 클라이언트가 agent actor인데 principal_id를 보내지 않던 흐름이 차단될 수 있음.
- Mitigation: reason_code를 명확히 제공해 클라이언트가 즉시 수정 가능하게 함.

## 8) Rollback plan
- authorize.ts의 agent principal 검사와 contract 추가 케이스를 revert하면 이전 동작으로 복귀 가능.
