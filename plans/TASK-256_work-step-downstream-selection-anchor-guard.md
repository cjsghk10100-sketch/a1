# TASK-256: Work Step Downstream Selection Anchor Guard

## 1) Problem
Step 생성 비동기 완료 시 `selectDownstreamStepForRun`이 ToolCalls/Artifacts 대상 step 선택을 새 step으로 강제한다. 요청 도중 사용자가 이미 다른 step을 선택한 경우에도 덮어써서 컨텍스트 혼선을 유발할 수 있다.

## 2) Scope
In scope:
- `apps/web/src/pages/WorkPage.tsx`의 downstream step 선택 적용에 anchor guard 추가
- create-step 성공 경로에서 anchor를 전달하도록 갱신

Out of scope:
- API/DB/event/projector 변경
- WorkPage 외 변경

## 3) Constraints (Security/Policy/Cost)
- 정책/승인/감사 로직 변경 없음
- UI 상태 정합성 강화만 수행
- 의존성 추가 없음

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/WorkPage.tsx`
- New files:
  - `/Users/min/Downloads/에이전트 앱/plans/TASK-256_work-step-downstream-selection-anchor-guard.md`

## 5) Acceptance criteria (observable)
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과
- 수동 스모크:
  1. Step 생성 클릭 후 응답 전 ToolCalls/Artifacts step 선택 변경
  2. 응답 후에도 사용자가 바꾼 선택이 유지됨

## 6) Step-by-step plan
1. downstream step 선택 helper를 anchor-aware로 확장한다.
2. create-step 요청 시작 시 tool/artifact step selection anchor를 캡처한다.
3. 성공 시 helper를 anchor 포함 호출로 교체한다.
4. 타입체크/테스트를 실행한다.

## 7) Risks & mitigations
- Risk: 생성 직후 자동 포커스가 줄어들 수 있음
- Mitigation: 사용자가 선택을 바꾸지 않은 경우 기존 자동선택 유지

## 8) Rollback plan
- `apps/web/src/pages/WorkPage.tsx`의 helper/호출부를 이전 커밋으로 롤백
