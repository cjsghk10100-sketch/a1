# TASK-260: Policy Violations Signal Alignment (UI)

## 1) Problem
Agent Profile에서 표시하는 `Policy violations (7D)`는 trust 집계 기준과, 화면의 사유(reason) 표기가 완전히 일치하지 않을 수 있다. 운영자가 “무엇이 위반 카운트에 들어갔는지”를 즉시 추적하기 어렵다.

## 2) Scope
In scope:
- Agent change timeline 조회 대상에 위반 이벤트(`egress.blocked`, `data.access.denied`, `policy.denied`) 포함
- agent 관련 이벤트 필터에서 `actor_principal_id` 기반 매칭 추가
- 위반 사유(top reasons) 집계를 위 3개 이벤트 기반으로 정렬
- Trust 카드에 최근 위반 이벤트 목록(Inspector 딥링크) 추가
- i18n(en/ko) 키 추가

Out of scope:
- Trust 산식/백엔드 집계 변경
- DB/event schema 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 API 계약 변경 없이 web-only로 구현
- 표시용 파생 데이터만 사용
- 새로운 의존성 추가 금지

## 4) Repository context
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm lint` 통과
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 수동 확인:
  - Agent Profile Trust 카드에서 최근 위반 이벤트가 보인다.
  - 위반 이벤트 클릭 시 Inspector로 이동한다.
  - Top reasons가 위반 이벤트 reason_code 기반으로 표시된다.

## 6) Step-by-step plan
1. 위반 이벤트 타입 상수 추가 및 timeline 이벤트 타입 목록 확장.
2. relevantChangeEvents 필터에 `actor_principal_id` 매칭 추가.
3. 위반 reason 집계/최근 위반 이벤트 파생값 추가.
4. Trust 카드 UI 및 i18n 반영.
5. lint/typecheck/api test 검증.

## 7) Risks & mitigations
- Risk: 일부 이벤트에 reason_code가 없을 수 있음
- Mitigation: `unknown` fallback 라벨을 사용해 누락 없이 집계

## 8) Rollback plan
- AgentProfilePage의 위반 이벤트 파생/표시 코드 제거
- i18n 신규 키 제거
