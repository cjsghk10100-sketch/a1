# TASK-245: Agent List Cursor Pagination + Web Load More

## Summary
Agent 목록이 커져도 안정적으로 로드되도록 `/v1/agents`에 cursor 기반 pagination을 추가하고, Agent Profile 화면에서 `Load more`로 추가 페이지를 가져오게 만든다.

## Scope
In scope:
- API: `GET /v1/agents`에 `cursor` query 지원
- API: 응답에 `next_cursor`, `has_more` 추가
- Shared type: 목록 응답에 pagination 필드 추가
- Web API helper: page 단위 조회 함수 추가
- Web UI: Agent Profile에서 초기 로드 + 추가 로드(load more) + 새로고침 시 cursor reset
- Contract test: `/v1/agents` pagination smoke 보강

Out of scope:
- DB schema 변경
- 다른 리소스 endpoint pagination
- Agent selector virtualization

## Files
- `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- `/Users/min/Downloads/에이전트 앱/packages/shared/src/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## Acceptance
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Agent Profile:
  - 초기 1페이지 로드
  - `Load more` 클릭 시 다음 페이지 append
  - `Refresh` 시 목록 reset + 1페이지 재조회
