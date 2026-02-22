# TASK-284: Work Step Auto-Selection Regression Guard

## 1) Problem
`WorkPage`에서 `toolCallsStepId`/`artifactsStepId` 자동 선택 로직이 두 군데 effect에 인라인으로 중복되어 있다.  
분기 수정 시 한쪽만 반영되거나, loading/empty/preferred/current 유지 조건이 어긋나는 회귀가 발생할 수 있다.

## 2) Scope
In scope:
- step auto-selection 판단식을 순수 함수로 추출
- tool-calls/artifacts effect가 동일한 함수 결과만 반영하도록 정리
- loading/empty/current 유지/preferred/fallback 회귀 테스트 추가

Out of scope:
- API/DB/event 변경
- Work UI/문구 변경
- 저장소(localStorage) 키 구조 변경

## 3) Constraints (Security/Policy/Cost)
- 승인/정책/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.step-auto-selection.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. step auto-selection 로직을 `decideStepAutoSelection()`으로 추출한다.
2. tool-calls/artifacts effect가 함수 결과(`null|string`)를 공통 처리하도록 교체한다.
3. 회귀 테스트로 핵심 분기들을 고정한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: step 선택 UX가 바뀔 수 있음
- Mitigation: 기존 분기를 유지하고 동일 분기 테스트를 추가

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
