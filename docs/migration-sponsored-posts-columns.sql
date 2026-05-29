-- 협찬 게시물 추가 컬럼 (모니터링 페이지에서 필요한 필드)
-- Supabase 대시보드 > SQL Editor에서 실행

ALTER TABLE sponsored_posts
  ADD COLUMN IF NOT EXISTS product_name  text,
  ADD COLUMN IF NOT EXISTS project_name  text,
  ADD COLUMN IF NOT EXISTS account_name  text,
  ADD COLUMN IF NOT EXISTS channel_type  text,
  ADD COLUMN IF NOT EXISTS cost          numeric,
  ADD COLUMN IF NOT EXISTS reach_count   bigint;
