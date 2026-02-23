# TASK-289: Work Run Tags CSV Parse Regression Guard

## 1) Problem
`submitCreateRun()`의 tags CSV 파싱이 인라인으로 존재해 추후 변경 시 trim/filter 규칙이 쉽게 어긋날 수 있다.

## 2) Scope
In scope:
- run tags CSV 파싱을 순수 helper로 추출
- create-run 핸들러가 helper를 사용하도록 정리
- blank/trim/empty-entry/중복 보존 회귀 테스트 추가

Out of scope:
- API/DB/event 변경
- 태그 정규화 정책 변경(중복 제거 등)

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tags-csv.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `parseRunTagsCsv()` helper를 추가한다.
2. `submitCreateRun()`에서 인라인 태그 파싱 대신 helper를 사용한다.
3. 회귀 테스트를 추가한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 기존 태그 파싱 동작 변화
- Mitigation: 기존 규칙(빈 항목 제거, 순서/중복 보존)을 테스트로 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
