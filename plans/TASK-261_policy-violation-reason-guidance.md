# TASK-261: Policy Violation Reason-Based Remediation Guidance

## 1) Problem
현재 Trust 카드의 위반 해결 가이드는 정적 문구 3개로 고정되어 있어, 실제 `reason_code` 상위 원인과 연결되지 않는다.

## 2) Scope
In scope:
- 상위 위반 reason_code를 기반으로 동적 remediation 가이드 생성
- reason_code 패턴별 가이드 매핑 로직 추가
- 기존 정적 가이드를 fallback으로 유지
- i18n(en/ko) 키 추가

Out of scope:
- 정책 엔진/백엔드 변경
- 자동 조치(격리/토큰회수) 실행

## 3) Constraints (Security/Policy/Cost)
- web-only 변경
- 기존 UI 계약/라우팅 유지
- 새로운 의존성 추가 금지

## 4) Repository context
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm lint` 통과
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 수동 확인:
  - 상위 reason_code가 capability/quota/quarantine 등일 때 해당 맞춤 가이드가 상단에 표시됨
  - reason_code가 없거나 미분류여도 기본 가이드는 표시됨

## 6) Step-by-step plan
1. reason_code -> guidance key 매핑 함수 추가.
2. 상위 reason_code에서 동적 guidance key 리스트 생성.
3. 기존 정적 remediation list를 동적+fallback 구조로 변경.
4. i18n 키 추가.
5. lint/typecheck/api test 검증.

## 7) Risks & mitigations
- Risk: 매핑 누락 시 의미 없는 가이드 표출
- Mitigation: 미분류 reason은 generic 가이드 + 기존 fallback 유지

## 8) Rollback plan
- reason-based 매핑 로직 제거
- 기존 정적 remediation 3개만 복원
