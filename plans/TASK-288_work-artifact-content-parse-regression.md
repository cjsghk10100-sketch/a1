# TASK-288: Work Artifact/Run Parse Path Unification Regression Guard

## 1) Problem
`WorkPage`에는 아직 create-run 입력 JSON, artifact content JSON/metadata JSON 파싱이 인라인으로 남아 있다.  
일부 분기만 수정되면 `invalid_json`/default JSON 동작이 쉽게 어긋난다.

## 2) Scope
In scope:
- create-run에서 `parseOptionalJsonInput()` 재사용
- artifact content 생성 분기를 `buildArtifactContent()` 순수 함수로 추출
- artifact metadata 파싱에 `parseOptionalJsonInput()` 재사용
- artifact content helper 회귀 테스트 추가

Out of scope:
- API/DB/event 변경
- UI/문구 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.artifact-content.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `buildArtifactContent()` helper를 추가한다.
2. create-run/artifact create 핸들러의 인라인 파싱 분기를 helper 호출로 교체한다.
3. artifact content 분기 테스트를 추가한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: artifact JSON default(`{}`) 동작 변경
- Mitigation: 해당 케이스를 테스트로 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
