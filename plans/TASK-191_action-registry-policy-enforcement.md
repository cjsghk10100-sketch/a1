# TASK-191: Action Registry Policy Enforcement (Zone + Reversible Guard)

## 1) Problem
- `sec_action_registry`는 존재하지만 정책 집행에서 실제로 사용되지 않아 `zone_required/reversible/requires_pre_approval`가 런타임 통제에 반영되지 않는다.
- 결과적으로 Zone 설계(sandbox/supervised/high_stakes)가 데이터 카탈로그에만 머물고, 실행 경로에서 강제되지 않는 구멍이 있다.

## 2) Scope
In scope:
- Policy authorize 레이어에 action registry 조회/판단 추가
- `authorize_action` / `authorize_egress` 경로에서 registry 기반 결정 반영
- 계약 테스트에 zone/pre-approval 강제 케이스 추가

Out of scope:
- DB 스키마 변경
- Action registry CRUD 확장
- Web UI 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 `external.write` 승인 플로우(approval allow)는 깨지지 않아야 한다.
- 등록되지 않은 action은 기존 정책 동작을 유지한다(안전한 점진 강화).
- 정책 사유는 `reason_code`로 관측 가능해야 한다.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/authorize.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/policyGate.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_policy_enforcement.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_egress.ts`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- contract test에서 다음이 검증된다:
  - registered action의 zone 미스매치가 차단/승인요구로 반환됨
  - registered action의 pre-approval 요구가 반영됨

## 6) Step-by-step plan
1. authorize 레이어에 action registry 조회 유틸 추가(action_type 기준).
2. `zone_required`, `requires_pre_approval`, `reversible` 기반 전처리 정책을 정의하고 `authorizeCore`에 합성한다.
3. 기존 `evaluatePolicyDbV1` 결과와 충돌 시 보안 우선(deny > require_approval > allow)으로 병합한다.
4. contract tests에 registry enforcement 시나리오를 추가한다.
5. 타입체크 + 전체 API 계약 테스트 실행.

## 7) Risks & mitigations
- Risk: 기존 external.write 흐름 reason_code가 바뀌어 회귀를 유발할 수 있음.
- Mitigation: external.write 기본 경로의 decision/approval 동작은 유지하고, 신규 reason_code assertion은 추가 케이스에만 적용한다.

## 8) Rollback plan
- `authorize.ts` 및 계약 테스트 변경만 되돌리면 즉시 기존 동작으로 복귀 가능.
