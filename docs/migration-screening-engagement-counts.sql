-- screening_metrics: 참여수(좋아요/댓글 평균) 컬럼 추가
--
-- 배경: 2026-06-01 커밋 64990b3에서 apify-webhook 의 스크리닝 지표 계산에
--   total_avg_like_count / total_avg_comment_count 가 추가되어 insert 되는데,
--   대응 컬럼을 만드는 마이그레이션이 누락됨.
--   → 존재하지 않는 컬럼이 포함된 insert 를 PostgREST 가 통째로 거부(PGRST204)하여
--     스크리닝 실행 시 screening_metrics 에 행이 전혀 저장되지 않았음
--     (팔로워 수·알고리즘 계수·100만뷰 개수·총 평균 조회수 전부 "미수집").
--
-- 이 마이그레이션 적용 후 스크리닝을 다시 실행하면 정상 저장된다.

ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS total_avg_like_count NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS total_avg_comment_count NUMERIC DEFAULT NULL;
