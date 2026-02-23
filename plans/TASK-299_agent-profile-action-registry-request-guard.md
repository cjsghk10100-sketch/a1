# TASK-299: Agent Profile Action Registry Request Guard

## 1) Problem
Action Registry 로딩은 초기 로드와 수동 refresh 모두에서 단순 async 호출을 사용한다. 연속 클릭/중복 요청 시 마지막 응답 보장이 약해 stale 결과가 화면 상태를 덮을 수 있다.

## 2) Scope
In scope:
- Action Registry 로딩에 request sequence guard 추가
- 초기 로드/수동 refresh를 공용 `reloadActionRegistry()`로 통합

Out of scope:
- API/DB/event 변경
- Action Registry 데이터 구조 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. Action Registry 전용 request seq ref + begin/isLatest helper를 추가한다.
2. `reloadActionRegistry()`를 만들고 초기 로드/refresh 버튼에서 재사용한다.
3. 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 로딩 상태가 내려오지 않는 회귀 가능성
- Mitigation: finally에서 최신 요청 기준으로만 loading false 처리

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
