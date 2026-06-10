-- 협찬 게시물 '종료(삭제 추정)' 표시용 컬럼
-- 자동수집(apify-collect)이 "이전 조회수>0였는데 7일째 Apify 미반환"인 인스타 게시물에
-- ended_at(마지막 수집일)을 기록 → 이후 수집 제외 + 모니터링에 '종료' 뱃지 표시.
-- 데이터(과거 누적/그래프)는 그대로 보존된다.
alter table sponsored_posts add column if not exists ended_at date;
