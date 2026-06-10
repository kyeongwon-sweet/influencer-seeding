-- brand_daily_metrics: 수집 코드가 쓰는 지표 컬럼 보강
--
-- 배경: 테이블이 수동 생성돼 일부 컬럼이 없어, /api/brand-metrics/collect 의
--   upsert 가 "Could not find the 'yt_search_views' column ..." (PGRST204)로 통째 실패.
--   (measured_at 은 이미 존재 = onConflict 키)
-- 멱등(IF NOT EXISTS) — 이미 있는 컬럼은 건너뜀.

ALTER TABLE brand_daily_metrics ADD COLUMN IF NOT EXISTS yt_views          BIGINT DEFAULT NULL;
ALTER TABLE brand_daily_metrics ADD COLUMN IF NOT EXISTS yt_unique_viewers BIGINT DEFAULT NULL;
ALTER TABLE brand_daily_metrics ADD COLUMN IF NOT EXISTS yt_search_views   BIGINT DEFAULT NULL;
ALTER TABLE brand_daily_metrics ADD COLUMN IF NOT EXISTS ig_profile_views  BIGINT DEFAULT NULL;
ALTER TABLE brand_daily_metrics ADD COLUMN IF NOT EXISTS ig_reach          BIGINT DEFAULT NULL;
