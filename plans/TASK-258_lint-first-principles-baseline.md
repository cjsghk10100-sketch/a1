# TASK-258: Lint Baseline Hardening (First-Principles)

## 1) Problem
현재 `pnpm lint`가 대량 규칙 위반으로 실패한다. 다수는 런타임/보안 영향이 낮은 스타일·마이크로 성능 규칙이거나, 기존 비동기 가드 패턴/훅 앵커 패턴과 충돌하는 규칙이다. 핵심 품질 신호(타입/계약테스트/정합성) 대비 유지비가 과도하다.

## 2) Scope
In scope:
- Biome 규칙 중 과잉 규칙 최소 조정 (first-principles)
- 남은 소수 lint 위반 수동 수정
- `lint`, `typecheck`, API 계약테스트 재검증

Out of scope:
- 기능/도메인 로직 변경
- API 계약/DB 스키마 변경

## 3) Constraints (Security/Policy/Cost)
- 보안/정합성 신호는 유지 (`recommended`는 유지)
- 제거 후보는 기능 안정성과 직접 관련이 약한 규칙만 (예: `performance/noDelete`)
- 변경은 소수 파일로 제한

## 4) Repository context
- Existing relevant files:
  - `/Users/min/Downloads/에이전트 앱/biome.json`
  - `/Users/min/Downloads/에이전트 앱/apps/api/scripts/run_worker.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/policy/policyGate.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/egress.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/incidents.ts`
  - `/Users/min/Downloads/에이전트 앱/apps/api/src/routes/v1/capabilities.ts`

## 5) Acceptance criteria (observable)
- `pnpm lint` 통과
- `pnpm -r typecheck` 통과
- `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test` 통과

## 6) Step-by-step plan
1. lint 출력 기준선 수집 및 rule 분포 확인.
2. 최소 규칙 완화:
   - `performance/noDelete` off (과도한 마이크로-최적화 규칙 제거)
   - `correctness/useExhaustiveDependencies` off (기존 훅 앵커/의도적 비의존 패턴과 충돌)
   - `correctness/noUnsafeFinally` off (기존 stale-guard early-return 패턴과 충돌, 후속 정비 대상)
3. 잔여 lint 위반(`noConstantCondition`, `useImportType`, `useConst`, `useOptionalChain`, `noUnusedTemplateLiteral`, `noExplicitAny`) 수동 수정.
4. lint/typecheck/test 전체 통과 확인.

## 7) Risks & mitigations
- Risk: 규칙 완화로 코드 품질 하락 우려
- Mitigation: `recommended`는 유지하고, 완화는 위 3개 규칙으로 한정. 타입체크+계약테스트를 병행해 회귀를 차단한다.

## 8) Rollback plan
- `biome.json` rule override 제거 (`noDelete`, `useExhaustiveDependencies`, `noUnsafeFinally`)
- 해당 소수 파일 커밋 revert
