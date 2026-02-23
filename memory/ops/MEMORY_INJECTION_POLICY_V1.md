# MEMORY_INJECTION_POLICY_V1

목적: 메모리 과적재를 막고, 필요한 맥락만 안정적으로 주입한다.

## A. 자동 주입 대상 (Auto-injected)
- `MEMORY.md` (장기 핵심 기억)
- `memory/daily/` 최근 2일 로그

## B. 검색 대상 (On-demand retrieval)
- `memory/weekly/`, `memory/monthly/`
- `memory/reference/`, `references/`
- 과거 `memory/daily/` (최근 2일 제외)

## C. 운영 규칙
1. 저장은 넓게, 주입은 좁게.
2. 질의가 오면 `memory_search`로 관련 스니펫만 가져온다.
3. 반복 조회되는 정보는 `MEMORY.md` 승격 후보로 태깅한다.
4. 주간 점검에서 자동주입 범위를 과도하게 늘리지 않는다.
