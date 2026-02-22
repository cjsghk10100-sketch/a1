# TASK-279: Work Thread Selection Request-Anchor Regression Guard

## 1) Problem
`WorkPage`의 thread 생성 완료 경로는 비동기 응답 후 항상 새 thread를 선택한다.  
대기 중 사용자가 같은 room에서 다른 thread를 이미 선택했어도 stale 완료가 현재 선택을 다시 덮어쓸 수 있다.

## 2) Scope
In scope:
- thread 선택 판단 로직을 순수 함수로 분리
- create thread 완료 시 anchor 기반 가드 적용
- same room / switched room / stale anchor 불일치 케이스 회귀 테스트 추가

Out of scope:
- API/DB 변경
- Work UI 구조 변경
- i18n 문구 추가

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음
- 기존 room-scoped localStorage 저장 규칙 유지

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.thread-selection.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `WorkPage.tsx`에서 thread selection 판단식을 `decideThreadSelection()`으로 추출한다.
2. `selectThreadForRoom()`는 추출 함수 결과만 적용하도록 정리한다.
3. create thread 완료 경로에서 anchor(`threadIdRef`)를 넘겨 stale 덮어쓰기를 차단한다.
4. 회귀 테스트를 추가해 동작을 고정한다.
5. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 새 thread 생성 직후 자동 선택 UX가 달라질 수 있음
- Mitigation: anchor가 유지된 경우에는 기존처럼 자동 선택하고, 사용자가 명시적으로 변경한 경우만 덮어쓰기를 차단

## 8) Rollback plan
- 해당 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
