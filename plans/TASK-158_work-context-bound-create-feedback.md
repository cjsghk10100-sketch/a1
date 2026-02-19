# TASK-158: Work Context-Bound Create Feedback

## 1) Problem
Work 화면에서 create 계열 비동기 요청(run/step/toolcall/artifact/thread)이 완료될 때, 사용자가 이미 room/run/step을 전환한 상태라면 성공 힌트/입력 초기화가 현재 컨텍스트에 섞일 수 있다.

## 2) Scope
In scope:
- WorkPage create 성공 처리에서 컨텍스트 일치 시에만 성공 힌트 및 입력 초기화 적용
- 기존 context-bound persistence(`save*`)는 유지
- 기존 API/DB 계약은 변경하지 않음

Out of scope:
- API/DB/event/projector 변경
- 새 엔드포인트 추가
- Work 화면 구조 개편

## 3) Constraints (Security/Policy/Cost)
- Request != Execute 경계 변경 없음 (UI 후처리 안정화만 수행)
- 감사/이벤트 스키마 영향 없음
- 추가 의존성 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-158_work-context-bound-create-feedback.md`

## 5) Acceptance criteria (observable)
- Commands to run:
  - `pnpm -r typecheck`
  - `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Expected outputs:
  - typecheck 통과
  - contract test 통과

## 6) Step-by-step plan
1. create 성공 핸들러에서 요청 시점 context id(room/run/step)를 캡처한다.
2. 응답 적용 시점에 ref와 비교해 context가 동일할 때만 성공 힌트/폼 초기화를 반영한다.
3. context가 달라도 데이터 일관성을 위해 기존 `reload*` + room/run-scoped 저장 흐름은 유지한다.
4. 타입체크/테스트 후 커밋/푸시한다.

## 7) Risks & mitigations
- Risk: 컨텍스트 변경 시 성공 힌트가 보이지 않아 사용자 혼동 가능.
- Mitigation: 컨텍스트 오염 방지가 우선이며, 데이터 자체는 reload/persist로 유지.

## 8) Rollback plan
- `WorkPage.tsx`의 context-guard 조건을 제거하고 이전 성공 처리로 복원한다.
