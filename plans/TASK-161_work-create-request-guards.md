# TASK-161: Work Create Request Guards (Step/Toolcall/Artifact)

## 1) Problem
steps/toolcalls/artifacts 생성 요청이 비동기로 겹칠 때, 이전 요청의 늦은 응답이 최신 요청의 `loading/error/created` 상태를 덮어써 UI가 꼬일 수 있다.

## 2) Scope
In scope:
- createStep/createToolCall/createArtifact 흐름에 request token guard 도입
- 컨텍스트 리셋 effect에서 in-flight create 요청 무효화
- 최신 요청만 해당 create 상태를 갱신

Out of scope:
- API/DB/event/projector 변경
- createRun/createThread/createRoom/sendMessage 흐름 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/보안 경계 변경 없음
- 이벤트 스키마 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files to add:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-161_work-create-request-guards.md`

## 5) Acceptance criteria (observable)
- Commands to run:
  - `pnpm -r typecheck`
  - `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Expected outputs:
  - typecheck 통과
  - contract test 통과

## 6) Step-by-step plan
1. createStep/createToolCall/createArtifact 각각 request counter ref를 추가한다.
2. 요청 시작 시 request id를 발급하고 응답 적용 시 id가 최신일 때만 setState를 반영한다.
3. stepsRunId/toolCallsStepId/artifactsStepId 리셋 effect에서 request id를 증가시켜 기존 in-flight 요청을 무효화한다.
4. 타입체크/테스트 후 커밋/푸시한다.

## 7) Risks & mitigations
- Risk: guard 적용 범위 누락 시 일부 상태 꼬임이 남을 수 있음.
- Mitigation: create 3종 공통 패턴으로 동일하게 적용한다.

## 8) Rollback plan
- request counter ref와 조건문을 제거하고 기존 create 흐름으로 복원한다.
