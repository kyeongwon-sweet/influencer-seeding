-- 6/2 데이터 통계
SELECT 
  measured_at,
  COUNT(*) as count,
  SUM(play_count) as total_plays,
  AVG(play_count) as avg_plays
FROM post_daily_stats
WHERE measured_at >= '2026-06-01' AND measured_at < '2026-06-04'
GROUP BY measured_at
ORDER BY measured_at DESC;

-- 6/2에서 같은 post_id가 여러 번 나타나는지 확인
SELECT post_id, COUNT(*) as count
FROM post_daily_stats
WHERE measured_at = '2026-06-02'
GROUP BY post_id
HAVING COUNT(*) > 1
LIMIT 20;
