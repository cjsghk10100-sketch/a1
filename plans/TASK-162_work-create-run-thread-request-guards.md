# TASK-162: Work Create Request Guards (Run/Thread)

## 1) Problem
createRun/createThread 요청도 비동기 지연 시 이전 응답이 최신 컨텍스트의 상태(`loading/error/created`)를 덮어쓸 수 있다.

## 2) Scope
In scope:
- createRun/createThread에 request token guard 추가
- room 컨텍스트 리셋 시 in-flight 요청 무효화
- 최신 요청만 상태 반영

Out of scope:
- API/DB/event/projector 변경
- run/thread payload 구조 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/보안 경계 변경 없음
- 이벤트 계약 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-162_work-create-run-thread-request-guards.md`

## 5) Acceptance criteria (observable)
- Commands to run:
  - `pnpm -r typecheck`
  - `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Expected outputs:
  - typecheck 통과
  - contract test 통과

## 6) Step-by-step plan
1. createRun/createThread request counter ref 추가.
2. 요청 시작 시 request id를 발급하고, 응답 반영 시 최신 request인지 확인.
3. room 전환 effect에서 request counter를 증가시켜 stale 응답 무효화.
4. 타입체크/테스트 후 커밋/푸시.

## 7) Risks & mitigations
- Risk: guard 조건 과도 적용 시 성공 힌트 누락.
- Mitigation: 데이터 reload/persist는 유지하고, UI state만 최신 요청으로 제한.

## 8) Rollback plan
- request counter ref/조건문 제거 후 기존 흐름으로 복원.
