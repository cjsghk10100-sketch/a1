# TASK-298: Work Scope-Aware Disable/Empty States

## 1) Problem
Work 화면 일부 입력/버튼/empty 표시는 raw id(`threadId/stepsRunId/toolCallsStepId/artifactsStepId`) 기준이다. stale 값이 남아 있으면 API 호출은 가드로 막혀도 UI가 유효한 상태처럼 보일 수 있다.

## 2) Scope
In scope:
- Work 화면의 disabled/empty/select-prompt 조건을 scope-검증 id 기준으로 전환
- 대상: Steps, ToolCalls, Artifacts, Messages 섹션 및 Open Inspector 버튼

Out of scope:
- API/DB/event 변경
- 새로운 helper 추가

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 경계 변경 없음
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/web test`
- `pnpm lint`
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`

## 6) Step-by-step plan
1. 기존 scope helper로 계산한 `scoped*Id`를 섹션별 활성화 기준으로 사용한다.
2. disabled/empty/select_prompt 조건을 raw id에서 scoped id로 바꾼다.
3. 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 정상 경로까지 비활성화될 수 있음
- Mitigation: 기존 helper 재사용으로 판정 기준 일관성 유지 + 전체 테스트/타입체크 검증

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
