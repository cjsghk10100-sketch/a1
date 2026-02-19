# TASK-154: Work Run Quick Select (Use in Steps)

## 1) Problem
Work 화면에서 run을 조작하려면 Steps 섹션의 run 드롭다운까지 내려가서 수동 선택해야 한다. Runs 목록에서 작업 흐름을 이어갈 때 컨텍스트 전환이 잦다.

## 2) Scope
In scope:
- Web-only: Runs 목록 각 row에 `Use in Steps` 버튼 추가
- 클릭 시 해당 run을 Steps 대상 run으로 즉시 선택
- room-scoped 저장 규칙 유지 (`saveStepsRunId`)
- i18n EN/KO 키 추가

Out of scope:
- API/DB/event/projector 변경
- Runs/Steps 데이터 모델 변경

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- 변경 범위는 `apps/web` + 이 plan 파일로 제한.

## 4) Repository context
Relevant files:
- `apps/web/src/pages/WorkPage.tsx`
- `apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual smoke:
  1. `/work`에서 room 선택 후 run 2개 이상 생성
  2. Runs 목록에서 임의 run의 `Use in Steps` 클릭
  3. Steps 섹션 run 선택값이 해당 run으로 즉시 바뀌는지 확인

## 6) Step-by-step plan
1. Runs row 액션 영역에 `Use in Steps` 버튼 추가.
2. 클릭 시 room-bound helper(`selectStepsRunForRoom`) 호출.
3. i18n EN/KO 문자열 추가.
4. typecheck + contract-tests 실행 후 PR 생성.

## 7) Risks & mitigations
- Risk: 클릭 오동작으로 Steps 대상이 바뀔 수 있음.
- Mitigation: 명시적 버튼으로만 변경되게 하고 기존 run lifecycle 버튼과 분리.

## 8) Rollback plan
이 PR revert (web-only).

