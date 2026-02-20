# TASK-199: DLP Auto Redaction + event.redacted Emission

## 1) Problem
- 현재 이벤트 데이터에서 secret 패턴이 탐지되어도 저장 데이터는 그대로 남고, `secret.leaked.detected`/redaction log만 남는다.
- 운영 관점에서 “탐지”만으로는 부족하고, 최소한 이벤트 저장 단계에서 민감 문자열을 자동 마스킹해야 한다.

## 2) Scope
In scope:
- API DLP 유틸에 이벤트 데이터용 자동 마스킹 함수 추가
- `appendToStream()`에서 secret 탐지 시 `data`를 마스킹한 뒤 저장
- 마스킹 발생 시 `redaction_level=partial` 반영
- `event.redacted` 이벤트 자동 append
- contract test(`contract_secrets.ts`)에 redaction 동작 검증 추가

Out of scope:
- 과거 데이터 재마스킹(backfill)
- secrets API 응답 포맷 변경
- UI 신규 화면 추가

## 3) Constraints (Security/Policy/Cost)
- append-only 감사 원칙 유지 (원본 이벤트 수정 금지, redaction은 저장 시점에만 적용)
- DLP 이벤트(`secret.leaked.detected`) payload에는 원문 secret를 남기지 않는다.
- 기존 계약 테스트 흐름을 깨지 않도록 최소 변경으로 진행.

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/security/dlp.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/eventStore/index.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/test/contract_secrets.ts`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-199_dlp-auto-redaction-event-redacted.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- contract_secrets에서:
  - leaked message 이벤트가 `contains_secrets=true`
  - 저장된 message 이벤트 data에 원문 secret 토큰이 없음
  - `event.redacted`가 source_event_id 기준으로 생성됨

## 6) Step-by-step plan
1. `dlp.ts`에 unknown payload를 재귀적으로 마스킹하는 함수 추가.
2. `appendToStream()`에서 scan 결과가 secret이면 마스킹 결과를 data에 반영하고 redaction_level 세팅.
3. `event.redacted` 보조 이벤트 append 함수 추가 및 조건부 호출.
4. `contract_secrets.ts`에 redacted event/data 검증 추가.
5. 타입체크/계약테스트 실행 후 커밋.

## 7) Risks & mitigations
- Risk: 과도한 마스킹으로 정상 데이터까지 손실될 수 있음.
- Mitigation: DLP rule/key 패턴 매칭 영역만 치환하고, 구조(JSON shape)는 유지.

## 8) Rollback plan
- `appendToStream()`의 redaction 분기와 `dlp.ts` redaction 함수, contract test 변경을 revert하면 기존 shadow-detect only 동작으로 복구 가능.
