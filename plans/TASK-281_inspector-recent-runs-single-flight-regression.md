# TASK-281: Inspector Recent Runs Single-Flight Reload Regression Test

## 1) Problem
`InspectorPage`의 최근 Run 목록은 로딩 중 refresh 버튼을 비활성화해 중복 요청(경합)을 막는다.  
회귀 시 중복 요청이 허용되면 불필요한 API 호출과 목록 상태 불안정이 생길 수 있다.

## 2) Scope
In scope:
- Inspector recent runs reload single-flight 회귀 테스트 추가
- 로딩 중 중복 refresh 요청이 차단되는지 고정
- 로딩 완료 후 refresh가 다시 동작하는지 고정

Out of scope:
- Inspector 기능/레이아웃 변경
- API/DB/event 변경
- i18n 키 추가

## 3) Constraints (Security/Policy/Cost)
- 승인/정책/감사 경계 변경 없음
- 의존성 추가 없음(기존 vitest/testing-library/react-router 사용)

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/InspectorPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/InspectorPage.test.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. 첫 `listRuns`를 deferred로 걸어 mount 직후 로딩 상태를 유지한다.
2. 로딩 중 refresh 버튼이 비활성화되고 클릭해도 추가 호출이 발생하지 않는지 검증한다.
3. 첫 요청 완료 후 refresh가 다시 가능해지고, 두 번째 요청이 정상 반영되는지 검증한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 테스트가 버튼 비활성 상태를 브라우저별로 다르게 해석할 수 있음
- Mitigation: button.disabled 상태와 API 호출 횟수를 함께 검증

## 8) Rollback plan
- 테스트/플랜 파일만 revert하면 원복 가능
- 런타임 코드 변경 없음
