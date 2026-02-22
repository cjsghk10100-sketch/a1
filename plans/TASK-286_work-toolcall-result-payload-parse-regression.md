# TASK-286: Work ToolCall Result Payload Parse Regression Guard

## 1) Problem
`WorkPage`의 toolcall `succeed/fail` 액션은 JSON 파싱/trim 분기가 인라인 중복이다.  
분기 차이로 `invalid_json` 처리 불일치나 회귀가 발생할 수 있다.

## 2) Scope
In scope:
- toolcall succeed/fail payload 파싱 로직을 순수 함수로 추출
- 액션 핸들러가 추출 함수 결과만 사용하도록 정리
- trim/empty/json parse/invalid_json 회귀 테스트 추가

Out of scope:
- API/DB/event 변경
- UI/문구 변경

## 3) Constraints (Security/Policy/Cost)
- 승인/정책/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.toolcall-result-payload.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `parseToolCallSucceedPayload()`, `parseToolCallFailPayload()`를 추가한다.
2. toolcall 액션 핸들러 인라인 JSON.parse 분기를 함수 호출로 교체한다.
3. 회귀 테스트를 추가한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: invalid_json 처리 타이밍 변화
- Mitigation: 기존 처리 시점(요청 전 즉시 중단)을 유지하고 테스트로 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
