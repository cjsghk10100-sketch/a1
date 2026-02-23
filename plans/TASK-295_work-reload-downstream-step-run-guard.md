# TASK-295: Work Reload Downstream Step/Run Guard

## 1) Problem
`reloadToolCalls()`/`reloadArtifacts()`는 step id만 보고 조회한다. 비동기 경합 또는 stale 선택값으로 step이 현재 run 소속이 아닐 때도 조회가 발생할 수 있다.

## 2) Scope
In scope:
- ToolCalls/Artifacts reload 경로에 run-step 소속 검증 추가
- 불일치 시 다운스트림 상태 초기화 후 요청 중단
- helper 테스트 보강

Out of scope:
- API/DB/event 변경
- ToolCalls/Artifacts UI 구조 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.step-run-scope-guard.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `reloadToolCalls()`에서 `resolveRunScopedStepId()`로 대상 step을 검증한다.
2. `reloadArtifacts()`에서도 동일 검증을 적용한다.
3. helper 테스트에 빈 step 목록 케이스를 추가한다.
4. 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 유효 step reload가 차단될 수 있음
- Mitigation: 일치/불일치/빈 목록 케이스 테스트로 의도 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
