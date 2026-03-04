# TASK-421: Ops Dashboard Task2/Task3 Sequential Implementation

## 1) Problem
- Task1(엔진 ingest) 보강 이후, 대시보드(Task2/Task3)가 요구 문서 대비 미완성이다.
- 특히 의사결정 탭(Task3)이 아직 없고, 패널 데이터 공유가 약해 첫 로드/탭 전환 체감이 불안정하다.

## 2) Scope
In scope:
- Task2 안정화(상태 정규화/패널 데이터 공유 보강)
- Task3 의사결정 탭 라우팅 + 파생 분석 화면 추가
- 기존 API(health/issues/finance) 재사용만 수행

Out of scope:
- API/DB 스키마 변경
- 엔진/프로젝터/이벤트 타입 변경
- 새 의존성 추가

## 3) Constraints (Security/Policy/Cost)
- 읽기 전용 대시보드 유지 (쓰기 API 호출 금지)
- 공개 토큰 노출 금지 규칙 유지 (config 기반)
- 모든 사용자 노출 문자열 i18n 키 사용 (EN/KO)

## 4) Repository context
- Existing relevant files:
  - `apps/ops-dashboard/src/App.tsx`
  - `apps/ops-dashboard/src/router.tsx`
  - `apps/ops-dashboard/src/layout/GlobalHeader.tsx`
  - `apps/ops-dashboard/src/panels/HealthPanel/index.tsx`
  - `apps/ops-dashboard/src/panels/FinancePanel/index.tsx`
  - `apps/ops-dashboard/src/hooks/usePolling.ts`
- New files to add:
  - `apps/ops-dashboard/src/decision/*`
  - `apps/ops-dashboard/src/shared/DeepLink.tsx`
  - `apps/ops-dashboard/src/incidents/*`

## 5) Acceptance criteria (observable)
- `pnpm -C apps/ops-dashboard typecheck` 성공
- `pnpm -C apps/ops-dashboard test` 성공
- 라우팅:
  - `/decision` 진입 가능
  - 헤더 탭으로 `/overview` ↔ `/decision` 전환 가능
- Decision 화면에서 추가 API 없이 health/finance 기반 파생 표시

## 6) Step-by-step plan
1. 대시보드 컨텍스트에 최신 패널 데이터 공유 경로 추가.
2. Health/Finance 정규화/상태 보고 안정화(기존 동작 보존).
3. incidents 파생 스토어(클라이언트 메모리) 추가.
4. Decision 탭 라우팅/레이아웃/서브페이지 구현.
5. i18n 키 추가(EN/KO).
6. 테스트 보강 후 typecheck/test 실행.

## 7) Risks & mitigations
- Risk: 라우팅 변경으로 기존 경로 회귀
- Mitigation: 기존 `/overview`, `/health`, `/finance` 경로 유지 + Decision 경로만 추가

- Risk: 패널 상태 동기화 꼬임
- Mitigation: 컨텍스트 API를 additive 방식으로만 확장, 기존 `reportPanelStatus` 유지

## 8) Rollback plan
- 대시보드 관련 커밋 revert 1회로 롤백 가능 (API/DB 영향 없음).
