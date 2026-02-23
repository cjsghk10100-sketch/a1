# MEMORY_RUNTIME_SSOT

메모리 런타임 단일 진실원(SSOT)

> 본 문서는 운영(메모리 런타임) SSOT이며,
> 최상위(규범) SSOT는 `memory/ops/COMMON_CONSTITUTION_V1.md`이다.

## 계층
1. `memory/state.md` : 현재 상태(덮어쓰기)
2. `memory/daily/YYYY-MM-DD.md` : 일간 원본 로그(append)
3. `memory/weekly/` : 주간 압축
4. `memory/monthly/` : 월간 집계
5. `MEMORY.md` : 장기 요약/원칙

## 동기화 규칙
- 작업 시작/종료 시 state 갱신
- 의미 있는 실행은 daily에 즉시 append
- 주간/월간 정리 시 중복 제거 후 상위 요약으로 승격
