-- 게시물 업로드일 컬럼 추가
-- Supabase 대시보드 > SQL Editor에서 실행

ALTER TABLE influencers
  ADD COLUMN IF NOT EXISTS post_uploaded_at timestamptz;
