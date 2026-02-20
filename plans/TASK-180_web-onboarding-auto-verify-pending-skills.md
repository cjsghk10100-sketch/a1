# TASK-180: Onboarding Auto-Verify Pending Skills (First Review Pass)

## Summary
- Agent onboarding에서 skill inventory import 직후 `pending` 패키지를 자동 검수(verify)하는 옵션을 추가한다.
- 기본값은 ON으로 두어 “첫 인증 시 전체 스킬 1회 검수” 흐름을 바로 수행한다.

## Scope
In scope:
- Agent Profile onboarding UI에 auto-verify 토글 추가 (기본 ON)
- import 성공 후 pending 패키지 존재 시 자동으로 bulk verify 실행
- 수동 “Verify pending from this import” 버튼은 유지 (fallback)
- EN/KO i18n 키 추가

Out of scope:
- API/DB 스키마 변경
- verify 정책/판정 로직 변경

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## Acceptance
- `pnpm -r typecheck` 통과
- import 후 pending이 있으면(토글 ON) 자동으로 verify 진행률/오류가 기존 UI에 표시
- 토글 OFF 시 기존 수동 버튼 흐름만 동작
