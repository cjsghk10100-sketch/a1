# Knowledge Library

우리 팀의 공용 지식 도서관.

## 구조
- `books/` : 책/가이드 원문 또는 요약
- `research/` : 주제별 리서치 노트
- `playbooks/` : 실행/운영 플레이북
- `datasets/` : 데이터 소스 메타정보
- `indexes/` : 검색/태깅 인덱스(JSON)
- `templates/` : 요약/리서치/검증 템플릿

## 운영 원칙
1. 원문은 보존, 요약은 별도 파일로 분리
2. 파일명은 `YYYY-MM-DD_topic_vX.md` 권장
3. 인덱스에는 최소 `title, source, tags, updated_at` 포함
4. 품질이 검증된 항목만 playbook으로 승격

## 첫 시작 제안
- `howcryptoworksbook`는 `books/crypto/`로 배치
- 챕터 인덱스는 `indexes/howcryptoworksbook.index.json`에 유지
