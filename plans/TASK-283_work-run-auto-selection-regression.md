# TASK-283: Work Run Auto-Selection Regression Guard

## 1) Problem
`WorkPage`는 run 목록이 바뀔 때 `stepsRunId`를 자동 보정한다.  
조건식이 인라인으로 유지되어 회귀 시 잘못된 run이 선택되거나 선택이 비워지지 않는 문제가 생길 수 있다.

## 2) Scope
In scope:
- run auto-selection 판단식을 순수 함수로 추출
- 기존 effect는 추출 함수 결과만 반영하도록 정리
- loading/empty/preferred/current 유지 케이스 회귀 테스트 추가

Out of scope:
- API/DB/event 변경
- Work UI 구조 변경
- i18n 문구 추가

## 3) Constraints (Security/Policy/Cost)
- 정책/감사/승인 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.run-auto-selection.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. run auto-selection 조건식을 `decideRunAutoSelection()`으로 추출한다.
2. 기존 effect는 함수 반환값이 있을 때만 `setStepsRunId`를 적용한다.
3. 회귀 테스트로 핵심 분기(loading/empty/유지/createdRun 우선/fallback)를 고정한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: run 선택 UX가 미세하게 바뀔 수 있음
- Mitigation: 기존 조건을 동일하게 유지하고 분기 테스트를 추가

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
