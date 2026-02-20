# TASK-184: API Approval Mode Recommendation (OS-Level Calculation)

## 1) Problem
- 현재 Approval mode recommendation은 웹 UI에서만 계산한다.
- 동일 로직을 API/자동화/다른 UI에서 재사용할 수 없어 OS 레벨 계약으로 고정되지 않는다.

## 2) Scope
In scope:
- `GET /v1/agents/:agentId/approval-recommendation` 엔드포인트 추가
- 추천 계산 입력을 서버에서 직접 로드:
  - active capability token scopes
  - action registry (reversible/zone/pre/post + metadata cost/recovery)
  - trust score
  - latest daily snapshot(repeated mistakes, autonomy rate)
  - quarantine 상태
- 응답은 target별 mode + basis code 목록 반환
- 계약 테스트 추가

Out of scope:
- Policy Gate 런타임 강제 로직 변경
- 웹 화면 로직 전면 교체(후속 TASK)

## 3) Constraints (Security/Policy/Cost)
- 이벤트/감사 로그 스키마는 변경하지 않는다.
- 승인 추천은 “권고”이며 실행 권한/정책 강제는 기존 gate가 담당한다.
- 계산은 read-only query로 구현한다.

## 4) Repository context
- Existing files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/trust.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_trust.ts`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 계약 테스트에서 신규 endpoint 응답 형식/핵심 추천 모드 검증

## 6) Step-by-step plan
1. trust route에 추천 계산 유틸(스코프 union, action registry flag, basis code 계산) 추가.
2. `GET /v1/agents/:agentId/approval-recommendation` 구현.
3. `contract_trust.ts`에 endpoint 검증 케이스 추가.
4. 타입체크 + API 계약 테스트 실행.

## 7) Risks & mitigations
- Risk: 웹 추천 로직과 API 계산 로직 불일치.
- Mitigation: 기존 웹 로직과 동일한 조건 순서/임계값을 그대로 반영하고 basis code를 명시적으로 반환.

## 8) Rollback plan
- 신규 endpoint와 테스트만 되돌리면 기존 동작에 영향 없이 복구 가능.
