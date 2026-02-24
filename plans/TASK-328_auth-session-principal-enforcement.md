# TASK-328: Local Owner Auth + Session + Principal Mapping Enforcement

## Summary
`x-workspace-id` 신뢰 방식에서 벗어나 로컬 오너 계정/세션 토큰 기반 인증을 도입한다. API 요청은 인증된 세션에서 workspace/principal을 확정하고, 기존 라우트는 헤더를 직접 신뢰하지 않도록 공통 인증 훅에서 강제한다.

## Scope
In scope:
1. DB: local owner + auth session 테이블 추가
2. API: auth endpoints 추가 (`bootstrap-owner`, `login`, `refresh`, `logout`, `session`)
3. API: 공통 인증 preHandler 추가 (세션 토큰 검증, workspace/principal 매핑)
4. Web: 토큰 저장/자동 refresh + 첫 실행 bootstrap/login 자동화
5. 테스트: 기존 계약 테스트와 웹 테스트가 깨지지 않도록 보정

Out of scope:
1. 엔진 capability token 강제 (TASK-329)
2. run_attempts 모델 (TASK-330)
3. 운영 안전장치(runbook/rotation batch) 확장 (TASK-331)
4. 운영 대시보드 화면 통합 (TASK-332)

## Decisions
1. 기본 운영 모드는 세션 인증 강제 (`AUTH_REQUIRE_SESSION=true`)
2. 테스트/레거시 호환용으로만 `AUTH_ALLOW_LEGACY_WORKSPACE_HEADER=1` 제공
3. owner는 workspace당 1명 (현재 로컬 단일 사용자 가정)
4. session token은 해시 저장(평문 미저장), access/refresh 분리

## Acceptance
1. 인증 없이 보호 라우트 접근 시 `401`
2. `/v1/auth/bootstrap-owner` -> 첫 owner 생성 + session 발급
3. 웹 앱이 수동 헤더 없이 API 호출 성공(자동 bootstrap/login/refresh)
4. `pnpm -r typecheck`
5. `pnpm -C apps/web test`
6. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
