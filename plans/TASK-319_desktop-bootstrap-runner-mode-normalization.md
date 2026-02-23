# TASK-319: Desktop Bootstrap Runner Mode Normalization

## Summary
`VITE_DESKTOP_RUNNER_MODE`가 오타/미지원 값일 때 bootstrap UI와 복구 커맨드가 불일치하지 않도록 모드를 `embedded|external`로 정규화한다.

## Scope
- `DesktopBootstrapPage`에서 runner mode 정규화 유틸 추가
- 정규화 결과를 UI 표시, 복구 커맨드, 복사 컨텍스트에 일관 적용
- invalid mode 입력 시 embedded fallback을 검증하는 웹 테스트 추가

## Out of Scope
- desktop main process/env 로딩 변경
- i18n 키 추가

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
