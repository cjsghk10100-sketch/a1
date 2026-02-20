# TASK-186: Agent Profile Recommendation Refresh Hardening

## 1) Problem
- 승인 추천/권한 관련 상태가 변경되는 액션(격리/해제, 승급 승인) 직후에 UI가 즉시 동기화되지 않을 수 있다.
- 사용자가 수동 새로고침하기 전까지 오래된 추천/토큰 상태가 보일 위험이 있다.

## 2) Scope
In scope:
- Agent Profile에 approval recommendation 수동 refresh 버튼 추가
- 상태 변경 액션 성공 후 recommendation 재조회
- 승급 승인 성공 후 capability tokens도 즉시 재조회

Out of scope:
- API 스키마/정책 로직 변경

## 3) Constraints (Security/Policy/Cost)
- 읽기 재조회만 수행하며 권한/정책 결정 로직은 변경하지 않는다.
- 실패 시 기존 데이터는 유지하고 오류 코드만 표시한다.

## 4) Repository context
- Existing files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 격리/해제/승급 승인 후 recommendation이 즉시 업데이트
- 승급 승인 후 permissions matrix(토큰 기반)도 즉시 업데이트

## 6) Step-by-step plan
1. `reloadTokens`, `reloadApprovalRecommendation` 헬퍼 추가.
2. 관련 액션 핸들러에서 성공 시 헬퍼 호출.
3. approval recommendation 영역에 refresh 버튼 추가.
4. typecheck + API test.

## 7) Risks & mitigations
- Risk: 잦은 재조회로 UI 로딩 깜빡임.
- Mitigation: 액션 성공 시점에만 재조회하고, 섹션별 로딩 상태를 분리 유지.

## 8) Rollback plan
- 새 헬퍼 호출과 refresh 버튼을 제거하면 기존 동작으로 즉시 복구 가능.
