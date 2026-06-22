-- 일별 조회수(post_daily_stats)의 수동 수정 보호 플래그.
-- 대시보드에서 직접 수정한 (게시물·날짜)의 조회수는 manual=true로 표시되고,
-- 시트 자동 동기화(일자별 조회수 입력)가 그 행은 덮어쓰지 않고 건너뛴다.
-- Supabase SQL Editor에서 1회 실행.
ALTER TABLE post_daily_stats
  ADD COLUMN IF NOT EXISTS manual boolean NOT NULL DEFAULT false;
