# TASK-290: Work Create-Run Thread Room Guard

## 1) Problem
`submitCreateRun()`가 `thread_id`를 전송할 때 현재 선택된 room 소속인지 검증하지 않아, 룸 전환 경합 시 이전 룸 thread가 payload에 섞일 수 있다.

## 2) Scope
In scope:
- run 생성용 thread 선택 가드 helper 추가
- create-run payload에서 helper 결과만 사용
- room/thread 소속 불일치 회귀 테스트 추가

Out of scope:
- API/DB/event 변경
- thread 선택 UX 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.create-run-thread-guard.test.ts`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. room/thread 소속 검증 helper를 추가한다.
2. create-run payload에서 helper 결과를 사용하도록 교체한다.
3. 불일치/공백/정상 케이스 회귀 테스트를 추가한다.
4. 전체 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 정상 thread 전달이 누락될 수 있음
- Mitigation: 일치/불일치 분기 테스트로 기존 의도(같은 room thread만 허용) 고정

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
