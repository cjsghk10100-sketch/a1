# TASK-257: Work ToolCall JSON Error Context Guard

## 1) Problem
Work > ToolCalls에서 succeed/fail payload JSON 파싱 실패 시 `toolCallActionError`를 즉시 설정한다. 이때 사용자가 스텝/런을 바꾼 직후라면 이전 컨텍스트 에러가 현재 화면에 남을 수 있다.

## 2) Scope
In scope:
- `apps/web/src/pages/WorkPage.tsx` toolcall action JSON parse error 처리에 step-context guard 추가

Out of scope:
- API/DB/event/projector 변경
- ToolCall 동작 로직/엔드포인트 변경

## 3) Constraints (Security/Policy/Cost)
- Request != Execute 경계 변경 없음
- 승인/정책/감사 로직 변경 없음
- UI 상태 정합성만 보강

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-257_work-toolcall-json-error-context-guard.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 수동 확인:
  1. ToolCall 결과 JSON에 잘못된 값 입력
  2. 즉시 다른 step 선택
  3. 이전 step 기준 invalid_json 에러가 현재 step에 고정 노출되지 않음

## 6) Step-by-step plan
1. succeed/fail JSON 파싱 실패 시 현재 step 일치 여부 확인 후에만 `toolCallActionError`를 설정한다.
2. 기존 request/step guard와 조합해 stale 에러 표시를 차단한다.
3. 타입체크/계약테스트로 회귀를 확인한다.

## 7) Risks & mitigations
- Risk: 에러 표시가 과도하게 무시될 수 있음
- Mitigation: 현재 step 일치 시에는 기존과 동일하게 즉시 오류 노출

## 8) Rollback plan
- `apps/web/src/pages/WorkPage.tsx`의 해당 조건부 가드만 제거하면 원복 가능
