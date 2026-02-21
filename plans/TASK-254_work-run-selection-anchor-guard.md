# TASK-254: Work Run Selection Anchor Guard

## 1) Problem
Run 액션(start/complete/fail) 또는 create-run 비동기 완료 시점에, 사용자가 이미 다른 Run을 선택했는데도 완료 핸들러가 `stepsRunId`/room별 persisted run 선택을 덮어쓸 수 있다. 이 경합은 Work > Steps/ToolCalls/Artifacts 패널의 대상 Run을 예상과 다르게 바꾸는 원인이 된다.

## 2) Scope
In scope:
- `apps/web/src/pages/WorkPage.tsx`에 run 선택 업데이트용 anchor guard 추가
- run 액션 및 create-run 완료 경로에서 guard를 사용하도록 갱신

Out of scope:
- API/DB/event/projector 변경
- WorkPage 외 다른 페이지 변경

## 3) Constraints (Security/Policy/Cost)
- Request != Execute 경계 변경 없음 (UI 상태 가드만 조정)
- Redaction/approval/policy 로직 변경 없음
- 추가 의존성 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-254_work-run-selection-anchor-guard.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 수동 확인:
  1. Room A에서 run X start/complete/fail 실행
  2. 응답 전 steps 대상 run을 Y로 변경
  3. 응답 후에도 현재 선택이 Y로 유지되는지 확인 (X로 강제 복귀하지 않아야 함)

## 6) Step-by-step plan
1. WorkPage의 run 선택 helper를 anchor-aware 형태로 확장한다.
2. create-run 및 run action(start/complete/fail) 요청 시작 시 selection anchor를 캡처한다.
3. 성공 경로의 run 선택 적용을 helper guard로 통일한다.
4. 타입체크/테스트를 실행해 회귀를 확인한다.

## 7) Risks & mitigations
- Risk: 신규 run 생성 후 자동 선택이 기대와 달라질 수 있음
- Mitigation: anchor가 깨지지 않은 경우 기존 동작 유지, 사용자가 명시적으로 selection을 바꾼 경우만 덮어쓰기 방지

## 8) Rollback plan
- `apps/web/src/pages/WorkPage.tsx`의 helper 및 호출부를 이전 커밋으로 되돌리면 즉시 복구 가능
