# TASK-293: Work Create-Step Run Room Guard

## 1) Problem
Step 생성 액션은 `stepsRunId`를 그대로 사용해 호출한다. 비동기 경합이나 stale 선택값으로 인해 현재 room 소속이 아닌 run으로 요청이 나갈 수 있다.

## 2) Scope
In scope:
- room/run 소속 검증 helper 추가
- Step 생성 액션에서 helper 적용
- 회귀 테스트 추가

Out of scope:
- API/DB/event 변경
- Step 생성 UI 구조 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.create-step-run-guard.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `resolveRoomScopedRunId()` helper를 추가한다.
2. Step 생성 경로에서 helper 결과를 사용해 run 대상을 제한한다.
3. helper 회귀 테스트를 추가한다.
4. 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 유효 run이 과차단될 수 있음
- Mitigation: 일치/불일치/trim/공백 케이스 테스트로 의도 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
