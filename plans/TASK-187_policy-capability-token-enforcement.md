# TASK-187: Policy Gate Capability Token Enforcement (Runtime)

## 1) Problem
- 현재 capability token은 발급/회수/delegation은 구현되어 있으나, 정책 평가 경로에서 실제 스코프 강제가 약하다.
- 결과적으로 token이 있어도 런타임 접근 제어(방/액션/데이터/egress 도메인)가 일관되게 보장되지 않는다.

## 2) Scope
In scope:
- `authorizeCore`에 capability token 유효성 검증 추가
  - 존재 여부, revoked, 만료, principal 매칭
- category별 최소 스코프 강제 추가
  - room scope
  - action_types scope (`authorize_action`/`authorize_egress`)
  - data_access scope (`authorize_data_access`)
  - egress_domains scope (`authorize_egress`, 입력 context 기반)
- egress/data routes가 필요한 context를 policy gate로 전달하도록 보강
- 계약 테스트 추가

Out of scope:
- capability token 스키마 변경
- toolcall API 전체를 policy gate로 재배선
- 웹 UI 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 승인/kill-switch/quota/학습 이벤트 흐름은 유지한다.
- token 미지정 호출의 기존 동작은 깨지지 않도록 유지(점진적 도입).
- 새로운 거부는 명확한 `reason_code`를 반환한다.

## 4) Repository context
- Existing files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/egress.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/dataAccess.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_capabilities.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_egress.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_data_access.ts`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 신규 계약 테스트에서 아래 검증:
  - 만료/회수/주체불일치 token 차단
  - egress 도메인 스코프 불일치 차단
  - data access 스코프 불일치 차단

## 6) Step-by-step plan
1. `authorize.ts`에 token 로딩/검증 + scope match 유틸 추가.
2. `authorizeCore`에 token 검증 결과를 선반영하고 reason code/blocked 처리.
3. `egress.ts`, `dataAccess.ts`에서 스코프 매칭에 필요한 context를 명시적으로 전달.
4. 계약 테스트 보강 후 타입체크 + API 테스트 실행.

## 7) Risks & mitigations
- Risk: 기존 테스트/흐름이 token 강제로 깨질 수 있음.
- Mitigation: token이 제공된 경우에만 강제하고, 점진적으로 strict mode는 후속 TASK로 분리.

## 8) Rollback plan
- `authorize.ts`의 capability enforcement 블록과 관련 테스트만 되돌리면 기존 정책 동작으로 즉시 복구 가능.
