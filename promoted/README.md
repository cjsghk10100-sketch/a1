# promoted/

승격 산출물 집계 폴더.

- `promoted/inbox/` : 대시보드에서 내보낸 승격 파일을 넣는 곳
- `promoted/applied/` : 적용 완료 후 보관하는 곳

흐름:
1. 대시보드에서 Markdown 내보내기
2. 파일을 `promoted/inbox/`에 저장
3. 적용 스크립트 실행: `python3 scripts/apply_promotions.py`
4. 적용된 파일은 `promoted/applied/`로 자동 이동
