# TASK-153: Work Run Action Auto-Select

## 1) Problem
Work의 Runs 목록에서 `Start/Complete/Fail`를 실행해도 Steps 섹션 선택 run이 이전 값으로 남을 수 있다. 이 경우 다음 step/toolcall/artifact 조작 대상이 어긋나기 쉽다.

## 2) Scope
In scope:
- Web-only: Runs 액션(`Start/Complete/Fail`) 성공 시 해당 run을 Steps 선택으로 자동 전환

Out of scope:
- API/DB/event/projector 변경
- Runs 목록 정렬/필터 변경

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- 변경 범위는 `apps/web` + 이 plan 파일로 제한.

## 4) Repository context
Relevant file:
- `apps/web/src/pages/WorkPage.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual smoke:
  1. `/work`에서 run A를 Steps에 선택
  2. Runs 목록에서 run B의 `Start` 클릭
  3. Steps 선택이 run B로 바뀌는지 확인
  4. run B에서 `Complete` 또는 `Fail` 후에도 선택이 run B 유지되는지 확인

## 6) Step-by-step plan
1. Runs 액션 성공 경로에 `setStepsRunId(r.run_id)`를 추가한다.
2. 타입체크/계약테스트 실행.
3. PR 생성.

## 7) Risks & mitigations
- Risk: 사용자가 다른 run을 계속 보고 싶을 수 있음.
- Mitigation: run 액션은 명시적으로 해당 run을 조작하는 행위이므로 대상 동기화 우선.

## 8) Rollback plan
이 PR revert (web-only).

