# TASK-157: Work Thread Selection Room-Bound

## 1) Problem
Work 화면에서 thread 생성/재로딩 비동기 완료 시점에 room 전환이 겹치면, 이전 room의 thread_id가 현재 컨텍스트에 반영될 여지가 있다.

## 2) Scope
In scope:
- Web-only `WorkPage`에 room-bound thread 선택 helper 추가
- thread 생성 성공/threads 재로딩 시 helper 사용

Out of scope:
- API/DB/event/projector 변경
- UI 문구 변경

## 3) Constraints (Security/Policy/Cost)
- no new dependency
- 변경 범위 최소화 (`apps/web` + plan)

## 4) Repository context
Relevant files:
- `apps/web/src/pages/WorkPage.tsx`

New files:
- `plans/TASK-157_work-thread-selection-room-bound.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual smoke:
  1. room A에서 thread 생성 클릭 직후 room B 전환
  2. A 응답 완료 후에도 현재(room B) thread 선택이 A로 덮어쓰기되지 않음

## 6) Step-by-step plan
1. `selectThreadForRoom(roomId, threadId)` helper 추가.
2. `reloadThreads`에서 stored/first 적용 시 helper 사용.
3. thread 생성 성공 경로에서 roomId 캡처 + helper 사용.
4. typecheck + contract tests 실행.

## 7) Risks & mitigations
- Risk: helper 적용 시 기존 자동선택 흐름 변경 가능.
- Mitigation: 현재 room 일치 시 기존과 동일하게 즉시 상태 반영.

## 8) Rollback plan
이 PR revert (web-only)
