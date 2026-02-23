# TASK-294: Work Reload-Steps Room/Run Scope Guard

## 1) Problem
room 전환 직후 `stepsRunId`가 localStorage의 오래된 run 값을 잠깐 가리킬 수 있다. 현재 `reloadSteps()`는 run-room 소속 검증 없이 호출되어, 잘못된 run의 step 목록을 불러올 가능성이 있다.

## 2) Scope
In scope:
- `reloadSteps()`에서 room/run 소속 검증 적용
- room-scoped run이 아닌 경우 step reload 즉시 중단 및 상태 초기화
- helper 회귀 테스트 보강

Out of scope:
- API/DB/event 변경
- Step/Run 선택 UI 구조 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.create-step-run-guard.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `reloadSteps()` 진입 시 run이 현재 room 소속인지 helper로 검증한다.
2. 불일치면 네트워크 요청 없이 steps 상태를 초기화하고 종료한다.
3. helper 테스트 케이스를 보강한다.
4. 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 정상이던 step reload가 차단될 수 있음
- Mitigation: room/run 일치/불일치/빈 목록 케이스 테스트로 의도 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
