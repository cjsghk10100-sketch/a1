# TASK-291: Work Send-Message Thread Room Guard

## 1) Problem
메시지 전송 시 `thread_id`를 현재 room 소속인지 검증하지 않아, 룸 전환 경합에서 이전 룸 thread로 전송될 가능성이 있다.

## 2) Scope
In scope:
- room/thread 소속 검증 helper를 공용화
- 메시지 전송 경로에서 소속 검증 통과 thread만 사용
- 기존 run-create thread 가드도 같은 helper로 통일
- 회귀 테스트 추가/정리

Out of scope:
- API/DB/event 변경
- 메시지 작성 UX 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.create-run-thread-guard.test.ts`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. room/thread 검증 helper를 범용 이름으로 정리한다.
2. create-run 및 send-message에서 helper를 재사용한다.
3. 회귀 테스트를 helper 이름/의도에 맞게 갱신하고 메시지 전송 가드 케이스를 보강한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 유효한 thread가 잘못 차단될 수 있음
- Mitigation: 일치/불일치/trim 케이스 테스트로 동작 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
