-- 100만뷰 이상 개수 컬럼 추가 (boolean → count로 대체)
-- Supabase 대시보드 > SQL Editor에서 실행

ALTER TABLE screening_metrics
  ADD COLUMN IF NOT EXISTS count_1m_view int;
