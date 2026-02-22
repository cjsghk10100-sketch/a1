# TASK-277: Work Steps Room-Scope Selection Regression Guard

## 1) Problem
`WorkPage`의 Run action(`start/complete/fail`)은 비동기 완료 후 `selectStepsRunForRoom()`를 호출한다.  
방 전환 타이밍과 anchor 조건이 섞이면 현재 방 컨텍스트를 오염시키는 회귀가 다시 들어올 위험이 있다.

## 2) Scope
In scope:
- `steps run selection` 결정을 순수 함수로 분리
- 동일 방/다른 방/anchor 불일치 케이스 회귀 테스트 추가
- 기존 동작 유지(저장 키/room-scoped localStorage 규칙 유지)

Out of scope:
- API/DB/event/projector 변경
- Work UI 구조 변경
- 새로운 i18n 문구 추가

## 3) Constraints (Security/Policy/Cost)
- Request != Execute 경계 변경 없음
- 감사/이벤트 로직 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/ApprovalInboxPage.test.tsx`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.selection.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `WorkPage.tsx`에서 run selection 판단 로직을 순수 함수로 추출한다.
2. 기존 `selectStepsRunForRoom()`는 추출된 결과만 적용하도록 정리한다.
3. 회귀 테스트(`WorkPage.selection.test.ts`)로 핵심 조건을 고정한다.
4. 전체 검증 커맨드를 실행한다.
5. 통과 시 커밋/푸시한다.

## 7) Risks & mitigations
- Risk: 기존 selection UX가 미세하게 바뀔 수 있음
- Mitigation: 함수 추출 전/후 조건식을 동일하게 유지하고 케이스 테스트로 고정

## 8) Rollback plan
- 해당 커밋 revert 시 기존 inline 조건식으로 복구 가능
- 데이터/마이그레이션 변경이 없으므로 롤백 영향이 코드 레벨로 한정됨
