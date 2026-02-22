# TASK-280: Notifications Room-Switch Stale Unread Regression Test

## 1) Problem
`NotificationsPage`는 unread 조회 중 room 전환이 일어나면 이전 요청 응답이 현재 room 이벤트 목록을 덮어쓰면 안 된다.  
코드에는 request/room guard가 있지만 회귀 테스트가 없어 재발 위험이 있다.

## 2) Scope
In scope:
- Notifications room-switch stale unread 시나리오 컴포넌트 테스트 추가
- 이전 room 응답이 무시되고 현재 room 응답만 반영되는지 고정

Out of scope:
- API/DB/event/projector 변경
- Notifications UI/기능 변경
- i18n 키 추가

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 로직 변경 없음
- 테스트 의존성 추가 없음(기존 vitest/testing-library 사용)

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/NotificationsPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/NotificationsPage.test.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. Notifications API를 mock하고 room 2개, stale/fresh unread 응답 시나리오를 구성한다.
2. room A에서 unread 요청 후 room B로 전환한 뒤 room A 응답이 와도 화면이 오염되지 않는지 검증한다.
3. room B unread 요청 결과만 표시되는지 검증한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: test가 비동기 타이밍에 flaky해질 수 있음
- Mitigation: deferred promise + 명시적 `waitFor`로 요청 순서와 DOM 반영을 고정

## 8) Rollback plan
- 테스트 파일/플랜 파일만 revert하면 즉시 원복 가능
- 런타임 코드 변경 없음
