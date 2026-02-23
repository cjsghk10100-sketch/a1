# TASK-322: Desktop Bootstrap Runner Mode Fallback Visibility

## Summary
잘못된 `DESKTOP_RUNNER_MODE` 입력이 `embedded`로 정규화될 때, 현재 UI는 최종 모드만 보여줘 원인 파악이 어렵다. bootstrap 화면에 “설정값(raw) + fallback 안내”를 노출해 진단 가능성을 높인다.

## Scope
- `DesktopBootstrapPage`에 raw mode 감지 및 fallback 여부 계산 추가
- fallback 발생 시 runtime 섹션에 raw 설정값과 fallback 안내 문구 렌더링
- EN/KO i18n 키 추가
- invalid mode 테스트에서 fallback 표시 검증 추가

## Out of Scope
- desktop main process/env 파서 변경
- 정책/런타임 동작 변경(정규화 동작은 유지)

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm -C apps/web test`
3. `DATABASE_URL='postgres://min@/agentapp_contract_test_codex?host=/tmp' pnpm -C apps/api test`
