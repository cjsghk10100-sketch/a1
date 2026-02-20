# TASK-197: Agent Onboarding Full Skill Review API

## 1) Problem
- 현재 온보딩 검수는 웹 클라이언트가 pending 패키지를 개별 verify 호출하는 방식에 의존한다.
- 에이전트 가입/첫 인증 시 서버 단에서 “전체 pending 스킬 1회 검수”를 실행하는 단일 API가 없어 일관성과 운영 자동화가 약하다.

## 2) Scope
In scope:
- `POST /v1/agents/:agentId/skills/review-pending` API 추가
- agent에 링크된 pending skill package 일괄 검수(verified/quarantined 전이)
- 전이 결과에 맞는 이벤트 기록(`skill.package.verified` / `skill.package.quarantined`)
- 계약 테스트에 review-pending 검증 시나리오 추가

Out of scope:
- web UI 전환(기존 개별 verify 플로우 교체)
- 암호학적 signature 검증 체계 도입

## 3) Constraints (Security/Policy/Cost)
- 검수 기준은 현재 verify 보안 계약과 동일하게 유지:
  - hash/manifest 유효성
  - signature 존재 필수
- pending만 대상으로 하며 verified/quarantined는 재처리하지 않음
- 에러 대신 요약 결과를 반환하여 운영 배치 호출에 적합하게 유지

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/agents.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_agents_onboarding.ts`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-197_agent-onboarding-review-pending-skills-api.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- contract에서:
  - import 후 pending 1개 존재
  - review-pending 호출 후 해당 항목이 quarantined(`verify_signature_required`)로 전이
  - `sec_agent_skill_packages`에 pending 없음

## 6) Step-by-step plan
1. agents route에 review-pending endpoint 추가.
2. pending package 일괄 판정/상태 전이/이벤트 기록 구현.
3. contract_agents_onboarding에 호출 및 결과 검증 추가.
4. 타입체크 + 전체 API 계약 테스트 실행.

## 7) Risks & mitigations
- Risk: 검수 로직이 verify 로직과 어긋나면 상태 전이 기준 불일치.
- Mitigation: hash/manifest/signature 판단 규칙을 verify와 동일한 코드 경로(동일 normalize 함수)로 맞춘다.

## 8) Rollback plan
- agents route의 review-pending 엔드포인트와 contract 추가 시나리오를 revert하면 기존 동작으로 복귀 가능.
