# TASK-324: Desktop Packaging (macOS arm64 zip/dmg)

## Summary
Electron desktop 런처에 `electron-builder` 기반 패키징을 추가하여 macOS arm64 기준 `.dmg/.zip` 산출을 제공한다.

## Scope
- `apps/desktop/package.json` 패키징 스크립트 추가
- `apps/desktop/electron-builder.yml` 추가
- root `package.json`에 `desktop:dist`, `desktop:dist:mac` 추가
- GitHub Actions 수동 패키징 워크플로우 추가

## Out of Scope
- 코드 서명/노타라이즈
- Windows/Linux 패키징

## Acceptance
1. `pnpm -r typecheck`
2. `pnpm desktop:dist:mac`
3. `apps/desktop/dist/*.dmg`, `apps/desktop/dist/*.zip` 생성 확인
