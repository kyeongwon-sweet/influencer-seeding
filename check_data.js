const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'web/.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  console.log('6/1-6/2 데이터 조회 중...\n');

  // 6/1-6/2의 모든 일일 통계 조회
  const { data, error } = await supabase
    .from('post_daily_stats')
    .select('measured_at, play_count, sponsored_posts(id, account_name, posted_at)')
    .gte('measured_at', '2026-06-01')
    .lte('measured_at', '2026-06-02')
    .order('measured_at', { ascending: false })
    .limit(1000);

  if (error) {
    console.error('Error:', error.message);
    return;
  }

  // 날짜별로 집계
  const byDate = {};
  data.forEach(d => {
    const date = d.measured_at.split('T')[0];
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(d);
  });

  Object.keys(byDate).sort().reverse().forEach(date => {
    const stats = byDate[date];
    const totalPlay = stats.reduce((sum, s) => sum + (s.play_count || 0), 0);
    const postCount = new Set(stats.map(s => s.sponsored_posts?.id)).size;
    
    console.log(`📅 ${date}: ${postCount}개 포스트, 총 조회수 ${totalPlay.toLocaleString()}`);
    
    // 조회수 상위 5개
    const top5 = stats
      .filter(s => s.play_count > 0)
      .sort((a, b) => (b.play_count || 0) - (a.play_count || 0))
      .slice(0, 5);
    
    top5.forEach(s => {
      console.log(`  └ [${s.sponsored_posts?.account_name || '?'}] ${s.play_count?.toLocaleString() || 0}`);
    });
    console.log('');
  });
})().catch(console.error);
