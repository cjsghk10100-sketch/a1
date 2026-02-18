# TASK-151: Work Persist Selection (Run/Step)

## 1) Problem
Work에서 Run/Step 선택은 새로고침 또는 room 전환 후에 첫 항목으로 돌아갈 수 있다. 로컬 운영 루프(Work로 만들고 Inspector/Timeline로 확인)에서 실수(잘못된 run/step 조작) 확률이 올라간다.

## 2) Scope
In scope:
- Web-only: Work에서 선택한 Run(Steps 섹션)을 room별로 `localStorage`에 저장/복원
- Web-only: Tool calls / Artifacts 섹션의 Step 선택을 run별로 `localStorage`에 저장/복원

Out of scope:
- API/DB/event/projector 변경
- 정렬/리스트 ordering 변경
- 다른 화면(Notifications/Timeline/Inspector) 변경

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- 변경 범위는 `apps/web` + 이 plan 파일로 제한.

## 4) Repository context
Relevant file:
- `apps/web/src/pages/WorkPage.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` (CI parity)
- Manual smoke:
  1. `/work`에서 room 선택 후 run 선택(또는 run 생성) → 새로고침
  2. Steps 섹션의 Run 선택이 복원되는지 확인
  3. Steps에서 특정 step 선택 → Tool calls/Artifacts의 step 선택을 바꾼 뒤 새로고침
  4. 해당 run에서 step 선택이 복원되는지 확인

## 6) Step-by-step plan
1. WorkPage에 run/step selection 저장 키를 추가한다.
2. room별 run 선택, run별 step 선택을 저장/복원한다.
3. typecheck + contract-tests 실행 후 PR 생성.

## 7) Risks & mitigations
- Risk: 저장된 step_id가 더 이상 존재하지 않아 선택이 깨질 수 있음.
- Mitigation: steps 목록에 존재하지 않으면 자동으로 첫 step으로 fallback.

## 8) Rollback plan
이 PR revert (web-only).

