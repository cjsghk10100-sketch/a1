# TASK-152: Work Run Create + Start

## 1) Problem
Work 화면에서 run 생성 후 `Start`를 다시 눌러야 해서 로컬 운영 루프(생성 → 시작 → step/toolcall/artifact)가 한 번 더 끊긴다.

## 2) Scope
In scope:
- Web-only: Runs 생성 섹션에 `Create + Start` 버튼 추가
- 생성 성공 직후 `run.start`까지 연속 호출
- 기존 `Create run` 버튼 동작 유지
- i18n EN/KO 키 추가

Out of scope:
- API/DB/event/projector 변경
- Run 생성 payload 스키마 변경

## 3) Constraints (Security/Policy/Cost)
- No secrets committed.
- 변경 범위는 `apps/web` + 이 plan 파일로 제한.

## 4) Repository context
Relevant files:
- `apps/web/src/pages/WorkPage.tsx`
- `apps/web/src/i18n/resources.ts`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck`
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
- Manual smoke:
  1. `/work`에서 room 선택 후 `Create + Start`로 run 생성
  2. Runs 목록에서 새 run 상태가 `running`인지 확인
  3. Steps 섹션이 새 run으로 자동 선택되는지 확인

## 6) Step-by-step plan
1. run 생성 로직을 재사용 가능한 내부 함수로 정리한다.
2. `Create + Start` 버튼을 추가하고, 생성 후 `startRun`을 연속 호출한다.
3. 성공/오류 상태를 기존 UI 패턴과 동일하게 처리한다.
4. i18n EN/KO 키를 추가한다.
5. typecheck + contract-tests 실행 후 PR 생성한다.

## 7) Risks & mitigations
- Risk: create는 성공하고 start가 실패하면 사용자 혼동 가능.
- Mitigation: 동일 errorBox에 실패 코드 표시 + created run id 유지로 즉시 재시도 가능하게 둔다.

## 8) Rollback plan
이 PR revert (web-only change).

