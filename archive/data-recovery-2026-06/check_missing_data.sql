-- 6/6, 6/7 데이터 현황 확인
SELECT 
  DATE(measured_at) as date,
  COUNT(*) as record_count,
  COUNT(DISTINCT post_id) as post_count,
  MAX(measured_at) as latest_time
FROM daily_stats
WHERE DATE(measured_at) IN ('2026-06-06', '2026-06-07')
GROUP BY DATE(measured_at)
ORDER BY date;

-- 가장 최근 데이터 확인
SELECT 
  DATE(MAX(measured_at)) as latest_date,
  COUNT(DISTINCT post_id) as posts_with_data,
  MAX(measured_at) as timestamp
FROM daily_stats
WHERE created_at >= NOW() - INTERVAL '7 days';

-- 6/6, 6/7에 수집되어야 할 포스트 목록
SELECT 
  id, url, product_name, project_name, posted_at,
  (SELECT COUNT(*) FROM daily_stats WHERE post_id = sponsored_posts.id AND DATE(measured_at) = '2026-06-06') as data_6_6,
  (SELECT COUNT(*) FROM daily_stats WHERE post_id = sponsored_posts.id AND DATE(measured_at) = '2026-06-07') as data_6_7
FROM sponsored_posts
WHERE posted_at <= '2026-06-07'
  AND (
    (SELECT COUNT(*) FROM daily_stats WHERE post_id = sponsored_posts.id AND DATE(measured_at) = '2026-06-06') = 0
    OR
    (SELECT COUNT(*) FROM daily_stats WHERE post_id = sponsored_posts.id AND DATE(measured_at) = '2026-06-07') = 0
  )
ORDER BY posted_at DESC
LIMIT 20;
