-- 대시보드에서 직접 수정한 게시물 메타 필드명을 기록.
-- 시트 자동 동기화(bulk)가 이 목록의 필드는 덮어쓰지 않도록 보존하는 용도.
-- Supabase SQL Editor에서 1회 실행.
ALTER TABLE sponsored_posts
  ADD COLUMN IF NOT EXISTS manual_fields text[] NOT NULL DEFAULT '{}';
