# TASK-185: Web Agent Profile Uses API Approval Recommendation

## 1) Problem
- 승인 모드 추천 계산이 웹 로컬 로직에 남아 있어, OS/API 계약과 분리된다.
- 동일 추천이 다른 클라이언트/자동화에서 재사용되지 못한다.

## 2) Scope
In scope:
- 웹 API helper에 `GET /v1/agents/:agentId/approval-recommendation` 추가
- Agent Profile에서 서버 추천 결과를 우선 사용
- basis code를 기존 i18n 키로 렌더링
- API 실패 시 기존 로컬 계산 fallback 유지

Out of scope:
- 정책 강제 로직 변경
- 신규 i18n 키 추가

## 3) Constraints (Security/Policy/Cost)
- 추천 결과는 read-only 표시이며 실행 권한 자체를 변경하지 않는다.
- fallback 유지로 회귀 위험 최소화.

## 4) Repository context
- Existing files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- New files:
  - 없음

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- Agent Profile에서 approval recommendation이 API 결과를 사용하고, API 실패 시 기존 로컬 추천이 계속 표시됨

## 6) Step-by-step plan
1. API helper 타입/함수 추가.
2. Agent Profile에 추천 fetch 상태(`loading/error/data`) 추가.
3. 렌더링에서 API 결과를 우선 사용하고 basis code를 i18n 변환.
4. typecheck + API test.

## 7) Risks & mitigations
- Risk: API 결과 형태 변경으로 UI 깨짐.
- Mitigation: 방어적 파싱 + fallback 추천 유지.

## 8) Rollback plan
- Agent Profile에서 API 추천 경로를 제거하고 기존 로컬 useMemo 추천만 다시 사용.
