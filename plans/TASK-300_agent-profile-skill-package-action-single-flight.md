# TASK-300: Agent Profile Skill Package Action Single-Flight

## 1) Problem
Skill package `verify/quarantine` 버튼은 row 단위로만 disabled 되어 있어 다른 row 액션을 동시에 실행할 수 있다. 이 경우 `skillPackagesActionId`가 경합하며 상태가 꼬일 수 있다.

## 2) Scope
In scope:
- Skill package verify/quarantine 액션을 single-flight로 제한
- 액션 실행 중 전체 row 버튼 비활성화
- finally에서 action id를 대상 row와 일치할 때만 해제

Out of scope:
- API/DB/event 변경
- Skill package 데이터 모델 변경

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
1. verify/quarantine 버튼 disabled 조건을 `Boolean(skillPackagesActionId)`로 통일한다.
2. onClick 시작 시 이미 action 진행 중이면 즉시 return한다.
3. finally에서 현재 action id가 본인일 때만 null로 해제한다.
4. 검증 커맨드를 실행한다.

## 7) Risks & mitigations
- Risk: 버튼 과비활성화로 UX 지연
- Mitigation: single-flight 완료 즉시 action id 해제, 실패 시 error 표시 유지

## 8) Rollback plan
- 커밋 revert로 즉시 복구 가능
- 데이터/마이그레이션 변경 없음
