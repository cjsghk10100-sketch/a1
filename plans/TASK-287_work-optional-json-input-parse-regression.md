# TASK-287: Work Optional JSON Input Parse Regression Guard

## 1) Problem
`WorkPage`의 create-step/create-toolcall 입력 JSON 파싱이 인라인 중복이라 분기 유지가 어렵다.  
trim/invalid_json 처리 차이가 생기면 UX가 흔들린다.

## 2) Scope
In scope:
- optional JSON 입력 파싱을 공통 순수 함수로 추출
- create-step/create-toolcall 핸들러가 공통 함수 사용
- blank/valid/invalid/trim 회귀 테스트 추가

Out of scope:
- API/DB/event 변경
- run/artifact 파싱 로직 변경 (후속)

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.optional-json-input.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `parseOptionalJsonInput()` 순수 함수를 추가한다.
2. create-step/create-toolcall 인라인 JSON.parse 분기를 함수 호출로 교체한다.
3. 회귀 테스트를 추가한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: blank JSON 처리 변화
- Mitigation: 기존(blank -> undefined) 동작을 테스트로 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
