# TASK-189: Enable `agent` Actor Type End-to-End

## 1) Problem
- `sec_principals`는 `principal_type='agent'`를 지원하지만, 이벤트 엔벨로프 `actor_type`은 아직 `service|user`만 허용된다.
- 결과적으로 에이전트 행위를 이벤트 레벨에서 1급 주체로 기록/검증하기 어렵다.

## 2) Scope
In scope:
- `evt_events.actor_type` 체크 제약에 `agent` 추가 (신규 migration)
- shared `ActorType`에 `agent` 추가
- API route의 actor 정규화 함수가 `agent`를 인식하도록 보강
- 타입체크/계약 테스트로 회귀 확인

Out of scope:
- 권한 모델 재설계
- 기존 이벤트의 actor 재마이그레이션
- UI 변경

## 3) Constraints (Security/Policy/Cost)
- append-only 이벤트 불변성은 유지한다.
- 기존 `user/service` 호출 동작은 깨지지 않아야 한다.
- 마이그레이션은 additive/forward-only로 작성한다.

## 4) Repository context
- Existing files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/001_evt_event_store.sql`
  - `/Users/min/Downloads/에이전트 앱/packages/shared/src/events.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/*.ts` (actor normalize helper들)
- New files:
  - `/Users/min/Downloads/에이전트 앱/apps/api/migrations/027_evt_actor_type_agent.sql`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- migration 적용 후 `evt_events.actor_type`에 `agent` insert가 허용됨(기존 테스트 회귀 없음)

## 6) Step-by-step plan
1. migration으로 `evt_events_actor_type_check`를 `('service','user','agent')`로 확장.
2. shared `ActorType`에 `Agent` 추가.
3. route actor normalizer들을 `agent` 인식으로 확장.
4. 타입체크 + API 전체 테스트 실행.

## 7) Risks & mitigations
- Risk: 제약 이름이 환경마다 달라 drop 실패 가능.
- Mitigation: 존재할 때만 drop하는 안전한 `DO $$` 블록 사용.

## 8) Rollback plan
- 신규 migration과 actor normalizer 변경만 되돌리면 기존 `service|user` 체계로 즉시 복구 가능.
