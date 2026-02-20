# TASK-188: Tool Call Policy Gate + Capability Scope Enforcement

## 1) Problem
- `/v1/steps/:stepId/toolcalls`는 현재 policy gate를 통과하지 않고 바로 `tool.invoked`를 append한다.
- 따라서 capability token의 `tools` 스코프가 실제 실행 경로에서 강제되지 않는다.

## 2) Scope
In scope:
- tool call 생성 라우트에 `authorize_tool_call` 연결
- body에 optional identity 컨텍스트 추가:
  - `actor_type`, `actor_id`, `principal_id`, `capability_token_id`, `zone`
- capability token 제공 시 `tools` 스코프 검사 강제
- 거부 시 `policy.denied` 흐름으로 반환 (`decision/reason_code/reason`)
- 계약 테스트 보강

Out of scope:
- tool 호출 성공/실패 라우트 재설계
- tool 정책 DSL 확장
- UI 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 run/step/tool projector 계약은 유지한다.
- token 미지정 기존 클라이언트 동작은 유지한다(점진 도입).
- 거부 사유는 reason_code로 명확히 노출한다.

## 4) Repository context
- Existing files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/toolcalls.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_toolcalls.ts`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 계약 테스트에서:
  - 허용된 tool scope + token으로 생성 성공
  - 불허 tool scope + token으로 생성 거부(`decision=deny`)

## 6) Step-by-step plan
1. `authorize.ts`에 tool category용 capability `tools` 스코프 검사 추가.
2. `toolcalls.ts`에 authorize 연결 + optional identity 필드 파싱.
3. `contract_toolcalls.ts`에 token 기반 allow/deny 케이스 추가.
4. 타입체크 + API 전체 테스트 실행.

## 7) Risks & mitigations
- Risk: 기존 테스트가 policy 응답 포맷 차이로 실패 가능.
- Mitigation: 거부 응답은 기존 policy endpoint와 동일 포맷(`decision/reason_code/reason`) 사용.

## 8) Rollback plan
- toolcall 라우트의 authorize 연결 및 tool scope 검사만 되돌리면 기존 실행 경로로 즉시 복구 가능.
