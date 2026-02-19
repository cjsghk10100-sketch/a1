# TASK-155: Work Async Selection Guards (Run/Step Context)

## 1) Problem
Work 화면에서 비동기 요청(steps/toolcalls/artifacts reload, step create)이 완료되는 시점에 사용자가 선택 컨텍스트(room/run/step)를 바꾸면, 이전 컨텍스트 응답이 현재 화면 상태를 덮어써 잘못된 대상이 표시될 수 있다.

## 2) Scope
In scope:
- Web-only (`WorkPage`) 비동기 완료 시 컨텍스트 불일치 응답 무시
- Step 생성 성공 시 step auto-select를 run-bound helper로 제한
- 기존 localStorage 선호 저장 키(run/step) 규칙 유지

Out of scope:
- API/DB/event/projector 변경
- UI 문자열/레이아웃 변경

## 3) Constraints (Security/Policy/Cost)
- Request/Execute 경계 및 서버 계약은 변경하지 않는다.
- no new dependency
- 변경 범위: `apps/web` + 본 계획 파일

## 4) Repository context
Relevant files:
- `apps/web/src/pages/WorkPage.tsx`

New files:
- `plans/TASK-155_work-async-selection-guards.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual smoke:
  1. `/work`에서 run A 선택 후 step 생성 버튼 클릭 직후 run B로 전환
  2. A 요청 완료가 돌아와도 현재(run B) step/tool/artifact 선택이 A로 덮어써지지 않아야 함

## 6) Step-by-step plan
1. `stepsRunId/toolCallsStepId/artifactsStepId` ref를 추가해 최신 선택 컨텍스트 추적.
2. `reloadSteps/reloadToolCalls/reloadArtifacts` 응답 적용 전 ref와 요청 대상 id를 비교해 stale 응답을 무시.
3. `selectDownstreamStepForRun(runId, stepId)` helper 추가 후 step 생성 성공 시 직접 set 대신 helper 사용.
4. typecheck + contract tests 실행.

## 7) Risks & mitigations
- Risk: stale 응답 무시로 상태 갱신이 누락될 수 있음.
- Mitigation: 현재 선택 컨텍스트용 요청은 별도로 다시 발생하므로 최신 요청만 반영되도록 보장.

## 8) Rollback plan
이 PR revert (web-only)
