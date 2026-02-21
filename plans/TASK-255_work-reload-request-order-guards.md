# TASK-255: Work Reload Request Order Guards

## 1) Problem
`WorkPage`의 `reloadThreads/messages/runs/egress/steps/toolCalls/artifacts`는 현재 컨텍스트(룸/스레드/런/스텝) 가드는 있지만, 동일 컨텍스트에서 연속 refresh 시 이전(느린) 응답이 나중(최신) 응답을 덮어쓸 수 있다.

## 2) Scope
In scope:
- `apps/web/src/pages/WorkPage.tsx` reload 함수에 request sequence guard 추가
- 동일 컨텍스트 재요청의 out-of-order 응답 무시

Out of scope:
- API/DB/event/projector 변경
- WorkPage 외 파일 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 로직 변경 없음
- UI 상태 일관성 강화만 수행
- 새 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-255_work-reload-request-order-guards.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 수동 스모크:
  1. Work 화면에서 동일 섹션 refresh를 빠르게 연타
  2. 마지막 요청 결과만 유지되고 중간 응답 역전으로 상태가 뒤집히지 않음

## 6) Step-by-step plan
1. 섹션별 request ref를 추가한다.
2. 각 reload 함수에서 requestId를 발급하고 success/error state 적용 시 requestId 일치 검사를 추가한다.
3. 기존 컨텍스트 가드(room/thread/run/step)와 조합해 stale 응답을 차단한다.
4. 타입체크/테스트로 회귀를 검증한다.

## 7) Risks & mitigations
- Risk: 과도한 guard로 정상 응답이 무시될 수 있음
- Mitigation: requestId + 기존 컨텍스트 가드를 함께 사용해 최신 요청만 허용

## 8) Rollback plan
- `apps/web/src/pages/WorkPage.tsx`의 request ref 및 조건부 state 적용 코드를 이전 커밋으로 되돌린다.
