# TASK-292: Work Step/Run Scope Guard for Tool/Artifact Actions

## 1) Problem
ToolCall/Artifact 생성 및 ToolCall 결과 액션에서 `step_id`가 현재 `run_id` 소속인지 보장하지 않아, 비동기 경합 시 잘못된 step 대상으로 쓰기가 발생할 수 있다.

## 2) Scope
In scope:
- run/step 소속 검증 helper 추가
- ToolCall 생성/성공/실패 액션에 helper 적용
- Artifact 생성 액션에 helper 적용
- 회귀 테스트 추가

Out of scope:
- API/DB/event 변경
- UI 구조 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.step-run-scope-guard.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `resolveRunScopedStepId()` helper를 추가한다.
2. ToolCall/Artifact 액션에서 helper 결과를 사용해 실행 대상을 제한한다.
3. helper 회귀 테스트를 추가한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 유효한 step 액션이 과도하게 차단될 수 있음
- Mitigation: 일치/불일치/trim/공백 케이스 테스트로 의도 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
