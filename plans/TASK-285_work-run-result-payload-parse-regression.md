# TASK-285: Work Run Result Payload Parse Regression Guard

## 1) Problem
`WorkPage`의 run `complete/fail` 액션은 summary/output, message/error JSON 파싱 분기를 각각 인라인으로 유지한다.  
중복 분기라서 한쪽만 수정되거나 trim/invalid_json 처리 차이가 생길 회귀 위험이 있다.

## 2) Scope
In scope:
- complete/fail payload 파싱 로직을 순수 함수로 추출
- 액션 핸들러는 추출 함수 결과만 사용하도록 정리
- trim/empty/json parse/invalid_json 분기 테스트 추가

Out of scope:
- API/DB/event 변경
- Work UI 문구/레이아웃 변경
- run action 정책 로직 변경

## 3) Constraints (Security/Policy/Cost)
- 승인/정책/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.run-result-payload.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. complete/fail payload 파서를 `parseRunCompletePayload()`, `parseRunFailPayload()`로 분리한다.
2. run 액션 핸들러에서 인라인 JSON.parse 분기를 제거하고 파서 결과를 사용한다.
3. 파서 회귀 테스트를 추가한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: invalid_json 반환 타이밍이 달라질 수 있음
- Mitigation: 기존 동작(파싱 실패 즉시 중단 + invalid_json) 그대로 유지하고 테스트 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
