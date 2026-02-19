# TASK-159: Work Action Request Guards (Run/Toolcall)

## 1) Problem
Room/step 전환 중 이전 비동기 액션(start/complete/fail, toolcall succeed/fail)이 늦게 완료되면, 최신 컨텍스트의 `*ActionId/*ActionError`를 덮어써서 버튼 상태/에러 표시가 꼬일 수 있다.

## 2) Scope
In scope:
- WorkPage에서 run action, toolcall action에 request token guard 추가
- 컨텍스트 리셋(useEffect) 시 in-flight 요청 무효화
- 최신 요청만 action state를 갱신하도록 보장

Out of scope:
- API/DB/event/projector 변경
- Work UI 구조 변경
- create 폼 상태 모델링 변경

## 3) Constraints (Security/Policy/Cost)
- 권한/정책 경계 변경 없음
- 이벤트/감사 계약 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-159_work-action-request-guards.md`

## 5) Acceptance criteria (observable)
- Commands to run:
  - `pnpm -r typecheck`
  - `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Expected outputs:
  - typecheck 통과
  - contract test 통과

## 6) Step-by-step plan
1. run/toolcall action별 request counter ref를 추가한다.
2. 각 액션 시작 시 request id를 발급하고, 응답 적용(catch/finally)에서 현재 id와 일치할 때만 상태를 반영한다.
3. room/step 컨텍스트 리셋 effect에서 request id를 증가시켜 기존 in-flight 응답을 무효화한다.
4. 타입체크/테스트 후 커밋/푸시한다.

## 7) Risks & mitigations
- Risk: guard 누락 시 일부 상태가 갱신되지 않을 수 있음.
- Mitigation: 기존 로딩/리셋 effect는 유지하고, guard는 run/toolcall action 상태에만 제한 적용.

## 8) Rollback plan
- request counter ref와 조건문을 제거하고 기존 단순 setState 흐름으로 복원한다.
