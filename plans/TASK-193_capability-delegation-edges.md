# TASK-193: Capability Delegation Edges (Persist + Query)

## 1) Problem
- 현재 delegation chain은 `sec_capability_tokens.parent_token_id`만으로 암묵적으로 표현된다.
- 감사/운영 UI에서 체인을 빠르게 조회하거나 parent-child edge 이력을 안정적으로 추적하기 어렵다.

## 2) Scope
In scope:
- delegation edge 저장 테이블 추가 (`sec_capability_delegation_edges`)
- parent 기반 grant 성공 시 edge row 기록
- delegation graph 조회 endpoint 추가
- contract test로 edge 생성/조회 검증

Out of scope:
- 기존 token schema 변경
- Web UI 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 grant/revoke 동작에 회귀가 없어야 함
- edge는 append-only 성격으로 운영(수정 없이 추가)
- workspace 스코프를 강제해 교차 워크스페이스 누락 방지

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/capabilities.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_capabilities.ts`
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/028_capability_delegation_edges.sql`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- contract에서:
  - parent delegation grant 성공 시 edge row 생성
  - graph endpoint 응답에 해당 edge 포함

## 6) Step-by-step plan
1. migration으로 delegation edges 테이블/인덱스 생성.
2. capabilities grant 성공 경로(parent_token_id 존재 시)에서 edge INSERT.
3. `GET /v1/capabilities/delegations?principal_id=...` endpoint 추가.
4. contract_capabilities에 parent delegation 성공 케이스 + endpoint/assertion 추가.
5. 타입체크/전체 테스트 실행.

## 7) Risks & mitigations
- Risk: edge insert 실패가 grant 자체를 실패시킬 수 있음.
- Mitigation: 동일 트랜잭션 내 처리하되 PK 충돌 방지를 위한 안정 ID/UNIQUE 조합 사용.

## 8) Rollback plan
- 신규 migration + capabilities 변경 + 테스트 변경만 revert하면 기능 전체를 안전하게 제거 가능.
