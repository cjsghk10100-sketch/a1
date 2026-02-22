# TASK-262: Events Query Subject Principal Filter Includes Actor Principal

## 1) Problem
`/v1/events?subject_principal_id=...`는 현재 `data.principal_id`/`data.issued_to_principal_id`만 조회한다.  
따라서 `policy.denied`/`policy.requires_approval`처럼 `actor_principal_id`에만 주체가 기록되는 이벤트가 누락된다.

## 2) Scope
In scope:
- Events API subject principal 필터에 `actor_principal_id` 매칭 추가
- 계약 테스트에서 actor principal 기반 조회가 되는지 검증 추가

Out of scope:
- 이벤트 스키마 변경
- 다른 필터 동작 변경

## 3) Constraints (Security/Policy/Cost)
- 조회 범위 확장만 수행(권한 모델/쓰기 경로 변경 금지)
- 기존 클라이언트 호환성 유지

## 4) Repository context
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/events.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_events_query.ts`

## 5) Acceptance criteria (observable)
- `pnpm lint` 통과
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 계약 테스트에서 `policy.requires_approval`가 `subject_principal_id`로 조회됨

## 6) Step-by-step plan
1. Events SQL where절에 `actor_principal_id = $n` 조건 추가.
2. contract_events_query에 agent principal 기반 policy 이벤트 생성 및 조회 검증 추가.
3. lint/typecheck/test 검증.

## 7) Risks & mitigations
- Risk: 필터 결과 증가로 기존 assertion 영향
- Mitigation: 테스트를 event_type로 좁혀 의도된 조건만 검증

## 8) Rollback plan
- events route 조건 추가분 제거
- contract test 추가 시나리오 제거
