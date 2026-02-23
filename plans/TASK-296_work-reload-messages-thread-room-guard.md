# TASK-296: Work Reload-Messages Thread/Room Guard

## 1) Problem
`reloadMessages()`는 thread id만 보고 조회한다. room 전환/선택 경합에서 현재 room 소속이 아닌 thread id가 남아 있을 때 메시지 조회가 발생할 수 있다.

## 2) Scope
In scope:
- `reloadMessages()`에 thread-room 소속 검증 추가
- 불일치 시 messages 상태 초기화 후 요청 중단
- helper 테스트 보강

Out of scope:
- API/DB/event 변경
- Messages UI 구조 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.create-run-thread-guard.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. `reloadMessages()` 진입 시 `resolveRoomScopedThreadId()`로 thread 소속을 검증한다.
2. 불일치면 네트워크 요청 없이 메시지 상태를 초기화하고 반환한다.
3. helper 테스트에 빈 목록 케이스를 추가한다.
4. 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 유효 thread 메시지 reload가 차단될 수 있음
- Mitigation: 일치/불일치/빈 목록 케이스 테스트로 의도 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
