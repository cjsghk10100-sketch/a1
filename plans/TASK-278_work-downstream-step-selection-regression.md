# TASK-278: Work Downstream Step Selection Regression Guard

## 1) Problem
`WorkPage`의 `selectDownstreamStepForRun()`는 step 생성/갱신 후 toolcalls/artifacts 기본 선택을 갱신한다.  
비동기 완료 시점에 run/step 컨텍스트가 바뀌면 stale anchor 덮어쓰기 회귀가 생길 수 있다.

## 2) Scope
In scope:
- downstream(step -> toolcalls/artifacts) 선택 판단 로직을 순수 함수로 분리
- same run / switched run / stale anchor 불일치 케이스 회귀 테스트 추가

Out of scope:
- API/DB 변경
- Work UI 구조 변경
- 새 i18n 문구 추가

## 3) Constraints (Security/Policy/Cost)
- 정책/감사/승인 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.downstream-selection.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `selectDownstreamStepForRun()` 내부 판단식을 순수 함수로 추출한다.
2. 기존 함수는 결정 결과만 적용하도록 정리한다.
3. 회귀 테스트로 stale anchor와 run 변경 케이스를 고정한다.
4. 전체 검증 실행 후 커밋/푸시한다.

## 7) Risks & mitigations
- Risk: 하위 선택 자동 갱신 UX가 바뀔 수 있음
- Mitigation: 기존 조건을 동일하게 보존하고 테스트로 동작을 잠근다

## 8) Rollback plan
- 커밋 revert만으로 복구 가능
- 데이터/스키마 변경 없음
