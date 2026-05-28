-- 협찬 게시물에 채널 분류 컬럼 추가
-- Supabase 대시보드 > SQL Editor에서 실행

ALTER TABLE sponsored_posts
  ADD COLUMN IF NOT EXISTS channel_type text;
