# TASK-156: Work Async Context Guards (Room/Thread)

## 1) Problem
Work 화면에서 room/thread를 빠르게 전환할 때 이전 요청 응답이 늦게 도착하면, 다른 컨텍스트 데이터(threads/runs/messages)가 현재 화면을 덮어쓰는 경합이 발생할 수 있다.

## 2) Scope
In scope:
- Web-only `WorkPage` 비동기 응답 적용 전 현재 room/thread 컨텍스트 일치 검사
- `reloadThreads`, `reloadRuns`, `reloadMessages` stale 응답 무시

Out of scope:
- API/DB/event/projector 변경
- UI/문구 변경

## 3) Constraints (Security/Policy/Cost)
- no new dependency
- 변경 범위 최소화 (`apps/web` + plan)

## 4) Repository context
Relevant files:
- `apps/web/src/pages/WorkPage.tsx`

New files:
- `plans/TASK-156_work-async-context-guards-room-thread.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual smoke:
  1. `/work`에서 room A 선택 후 즉시 room B로 전환
  2. A의 threads/runs 응답이 늦게 와도 현재 화면이 B 데이터 유지
  3. thread 전환 직후 메시지 목록이 이전 thread 응답으로 덮어쓰기되지 않음

## 6) Step-by-step plan
1. `threadIdRef`를 도입해 최신 thread 선택 추적.
2. `reloadMessages` 응답 적용 전 `threadIdRef` 일치 확인.
3. `reloadThreads`/`reloadRuns` 응답 적용 전 `roomIdRef` 일치 확인.
4. typecheck + contract tests 실행.

## 7) Risks & mitigations
- Risk: stale 응답 무시 시 로딩 체감 지연 가능.
- Mitigation: 최신 컨텍스트 요청은 별도 트리거되어 정상 반영.

## 8) Rollback plan
이 PR revert (web-only)
