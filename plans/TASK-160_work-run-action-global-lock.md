# TASK-160: Work Run Action Global Lock

## 1) Problem
Run 리스트에서 action 버튼 비활성화 조건이 현재 run id만 기준으로 걸려 있어, 한 run 액션 진행 중에도 다른 run 액션을 동시에 시작할 수 있다.

## 2) Scope
In scope:
- Run 리스트 action 버튼 disable 조건을 전역 in-flight 기준(`runActionId != null`)으로 강화
- 기존 UI/API 동작 유지

Out of scope:
- API/DB 변경
- Action queueing/parallel execution 모델 추가

## 3) Constraints (Security/Policy/Cost)
- 정책/승인 경계 변경 없음
- 감사/이벤트 스키마 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-160_work-run-action-global-lock.md`

## 5) Acceptance criteria (observable)
- Commands to run:
  - `pnpm -r typecheck`
  - `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Expected outputs:
  - typecheck 통과
  - contract test 통과

## 6) Step-by-step plan
1. Run action disable 조건을 `runActionId != null` 포함으로 수정한다.
2. 타입체크/테스트를 수행한다.
3. 커밋/푸시한다.

## 7) Risks & mitigations
- Risk: 과도한 disable로 UX가 답답해질 수 있음.
- Mitigation: action 완료 시 즉시 해제되고, 동시 실행으로 인한 상태 꼬임 방지가 우선.

## 8) Rollback plan
- disable 조건을 기존 `runActionId === r.run_id`로 되돌린다.
