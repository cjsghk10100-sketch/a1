# TASK-259: Agent Policy Violations Explainer & Remediation UI

## 1) Problem
`Agent Profile > Trust`에서 `Policy violations (7D)`가 숫자만 노출되어 의미와 대응 방법이 불명확하다. 운영자가 “왜 누적됐는지 / 무엇을 먼저 고쳐야 하는지”를 즉시 판단하기 어렵다.

## 2) Scope
In scope:
- Agent Profile Trust 카드에 `Policy violations (7D)` 설명 문구 추가
- 누적 수치 기반 severity 배지(정상/주의/위험) 표시
- 최근 제약/반복실수 데이터 기반 상위 reason code 요약 표시
- 즉시 실행 가능한 remediation 체크리스트(텍스트) 표시
- i18n 키(en/ko) 추가

Out of scope:
- API/DB/event schema 변경
- Trust 산식 변경
- 자동 조치(격리/토큰회수) 동작 변경

## 3) Constraints (Security/Policy/Cost)
- 기존 권한/정책 로직을 변경하지 않는다.
- 표시용 파생 데이터만 사용한다(이미 로드된 trust/constraints/mistakes).
- 새로운 의존성 추가 금지.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm lint` 통과
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 수동 확인:
  - Agent Profile > Growth > Trust 카드에서
    - violations 설명 문구가 보인다.
    - severity 배지가 수치에 따라 바뀐다.
    - 상위 reason code 목록이 표시된다(없으면 빈 상태 문구).
    - 해결 체크리스트가 보인다.

## 6) Step-by-step plan
1. `constraints`/`mistakes`를 합쳐 reason code 빈도 파생 로직 추가.
2. `policy_violations_7d`를 기준으로 severity 상태(healthy/caution/risk) 계산.
3. Trust 카드에 설명/배지/상위 reason code/해결 체크리스트 UI 추가.
4. en/ko i18n 키 추가.
5. lint/typecheck/api test로 회귀 검증.

## 7) Risks & mitigations
- Risk: reason code 집계가 운영자가 기대한 “정확한 카운트”와 다를 수 있음
- Mitigation: “최근 이벤트 기반 top reasons”로 라벨링하여 지표 의미를 명확히 표기

## 8) Rollback plan
- `AgentProfilePage.tsx`의 추가 UI/파생 로직 제거
- `resources.ts`의 신규 i18n 키 제거
