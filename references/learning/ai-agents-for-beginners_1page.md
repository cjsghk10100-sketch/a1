# AI Agents for Beginners — 1페이지 핵심 압축 (우리 운영 OS 기준)

소스: https://github.com/microsoft/ai-agents-for-beginners
용도: 보조 학습 자산(SSOT 대체 금지)

## 0) 우리에게 필요한 핵심만
이 코스는 입문/교육용 전체 커리큘럼이다. 우리 기준으로는 아래 8개 축만 흡수하면 ROI가 높다.

1. Agentic Design Patterns
2. Tool Use
3. Agentic RAG
4. Trustworthy Agents
5. Planning
6. Multi-Agent
7. Production
8. Context/Memory

## 1) 우리 문서에 매핑 (중복 방지)
- 패턴/플래닝/멀티에이전트: `MIN_ORG/03_PLAYBOOKS/00_MISSION_CONTROL_MVP.md`
- 신뢰/안전/정책: `memory/ops/EXECUTION_POLICY_V1.md`, `MIN_ORG/01_CONSTITUTION/RISK_POLICY.md`
- 실행증거/평가: `memory/ops/EVIDENCE_STANDARD_V1.md`, `MIN_ORG/01_CONSTITUTION/EXPERIMENT_SPEC.md`
- 승격/강등: `MIN_ORG/01_CONSTITUTION/PROMOTION_PIPELINE.md`
- 컨텍스트/메모리: `memory/ops/MEMORY_RUNTIME_SSOT.md`, `memory/ops/MEMORY_INJECTION_POLICY_V1.md`

원칙: 코스 내용은 참조 링크로만 유지, 규칙 원문은 우리 SSOT를 우선한다.

## 2) 즉시 적용 가능한 체크리스트
- [ ] 새 기능은 Agentic Pattern(도구/계획/멀티) 중 어디에 속하는지 먼저 분류
- [ ] Tool Use는 승인 경계(Request≠Execute) 안에서만 허용
- [ ] RAG/메모리는 자동주입 vs 검색대상 분리 정책 준수
- [ ] 운영 반영 전 Experiment/Scorecard로 최소 1회 검증
- [ ] PASS 누적 시에만 Promote, 실패/드리프트는 Demote

## 3) 버릴 것(우리 기준 비효율)
- 프레임워크 종속 구현 세부를 SSOT로 복붙하는 행위
- 교육 예제를 운영 규칙처럼 직접 채택하는 행위
- 지표 없이 “좋아 보임”으로 승격하는 행위

## 4) 다음 액션 (실행형)
1. 레슨별 핵심 1줄만 추려 `references/learning/`에 누적 (장문 금지)
2. 각 항목을 우리 정책 문서에 “참조 링크”로만 연결
3. 월 1회 정리: 실제 성과에 기여한 항목만 MEMORY 승격 후보로 표시

## 5) 결론
이 코스는 **시야 확장용**으로 매우 유용하다.
하지만 운영 핵심은 우리 SSOT(헌법/정책/플레이북)이며,
코스는 그 위에 덧대는 학습 입력으로만 운용한다.
