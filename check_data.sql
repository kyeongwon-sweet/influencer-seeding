-- 6/8 데이터 확인
SELECT 
  post_id,
  measured_at,
  play_count,
  likes_count,
  comments_count
FROM post_daily_stats
WHERE measured_at >= '2026-06-08'
ORDER BY measured_at DESC, post_id
LIMIT 20;
