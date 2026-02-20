# TASK-198: Web Onboarding Uses Agent Review-Pending API

## 1) Problem
- 현재 AgentProfile 온보딩의 “pending 검수”는 패키지별 verify 호출 루프를 클라이언트에서 수행한다.
- TASK-197에서 서버 일괄 검수 API가 생겼지만 UI는 아직 이를 사용하지 않아, 상태 동기화/실패 처리/운영 자동화 관점에서 중복 경로가 남아 있다.

## 2) Scope
In scope:
- web agents API helper에 review-pending 호출 추가
- AgentProfile onboarding의 pending 검수 버튼/자동검수에서 review-pending API 우선 사용
- 기존 개별 verify 루프는 fallback 경로로 유지(호환성)

Out of scope:
- skill packages 섹션의 단일 pending verify 버튼 제거
- i18n 문구 대규모 변경

## 3) Constraints (Security/Policy/Cost)
- UI 문자열은 기존 키 유지(기능 전환만 수행)
- 서버/API 실패 시 사용자 경험 회귀 방지를 위해 기존 개별 verify 루프로 fallback
- 요청 폭주는 줄이고(일괄 1회) 상태 정합성은 유지

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/api/agents.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/agents.ts`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-198_web-onboarding-use-review-pending-api.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 수동 점검:
  - 온보딩 import 후 pending 존재 시 “Verify pending” 클릭
  - pending 항목이 refresh 후 verified/quarantined로 반영

## 6) Step-by-step plan
1. shared agents 타입에 review-pending request/response 타입 추가.
2. web api helper(`agents.ts`)에 `reviewPendingAgentSkills()` 추가.
3. AgentProfile의 pending 검수 함수가 새 API를 먼저 호출하고 결과를 merge하도록 변경.
4. 실패 시 기존 per-package verify 루프 fallback 유지.
5. 타입체크 + 전체 계약 테스트 실행.

## 7) Risks & mitigations
- Risk: 서버/클라이언트 버전 불일치 시 새 API 호출 실패.
- Mitigation: catch에서 기존 verify 루프로 fallback.

## 8) Rollback plan
- AgentProfile 함수와 api helper 변경을 revert하면 기존 per-package verify 흐름으로 즉시 복귀.
