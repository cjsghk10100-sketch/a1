# TASK-179: Approval Recommendation with Risk Signals (Snapshot + Action Registry)

## Summary
- Agent Profile의 approval recommendation을 신뢰도(trust) + 액션 레지스트리뿐 아니라, 스냅샷 기반 리스크 신호(반복 실수/자율률 저하)까지 반영하도록 강화.
- 추천 모드마다 “왜 이 추천이 나왔는지”를 UI에 노출.

## Scope
In scope:
- `/apps/web/src/pages/AgentProfilePage.tsx` 추천 로직 업데이트
  - `latestSnapshot.repeated_mistakes_7d`, `latestSnapshot.autonomy_rate_7d` 반영
  - 기존 action registry 플래그와 결합해 보수적으로 downgrade
- `/apps/web/src/i18n/resources.ts` EN/KO 키 추가
  - 추천 근거(reason) 라벨

Out of scope:
- API/DB 변경
- Policy gate 런타임 강제 로직 변경

## Files
- `/Users/min/Downloads/에이전트 앱/apps/web/src/pages/AgentProfilePage.tsx`
- `/Users/min/Downloads/에이전트 앱/apps/web/src/i18n/resources.ts`

## Acceptance
- `pnpm -r typecheck` 통과
- Agent Profile에서 approval recommendation 각 행에 근거 텍스트가 표시
- 반복 실수/자율률 저하 시 추천이 더 보수적으로(예: auto→post/pre) 변함
