-- screening_metrics 테이블 확장
-- 필요한 모든 컬럼 추가

-- 게시물 통계 컬럼들
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS total_posts INTEGER DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS general_posts INTEGER DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS ad_posts INTEGER DEFAULT NULL;

-- 조회수 관련 컬럼들
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS total_avg_view_count NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS general_avg_view_count NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS ad_avg_view_count NUMERIC DEFAULT NULL;

-- 재생수 관련 컬럼들
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS total_avg_play_count NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS general_avg_play_count NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS ad_avg_play_count NUMERIC DEFAULT NULL;

-- 팔로워당 평균 조회수
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS avg_views_per_follower NUMERIC DEFAULT NULL;

-- 100만뷰 게시물 개수
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS count_1m_view INTEGER DEFAULT NULL;

-- 비율 관련 컬럼들
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS total_like_ratio NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS general_like_ratio NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS ad_like_ratio NUMERIC DEFAULT NULL;

ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS total_comment_ratio NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS general_comment_ratio NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS ad_comment_ratio NUMERIC DEFAULT NULL;

-- 최고 광고 성과
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS top_ad_play_count NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS top_ad_post_url TEXT DEFAULT NULL;

-- 평균 영상 길이
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS avg_video_duration NUMERIC DEFAULT NULL;

-- 검색어 관련 컬럼들
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS kw_keywords TEXT DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS kw_ad_date TEXT DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS kw_impact NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS kw_before NUMERIC DEFAULT NULL;
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS kw_after NUMERIC DEFAULT NULL;

-- 유형별 메트릭스 (JSON)
ALTER TABLE screening_metrics ADD COLUMN IF NOT EXISTS type_metrics JSONB DEFAULT NULL;
