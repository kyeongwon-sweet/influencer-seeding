require('dotenv').config({ path: './web/.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('🔍 Supabase 접속 정보:');
console.log('URL:', supabaseUrl ? supabaseUrl.substring(0, 30) + '...' : '없음');
console.log('Key:', supabaseKey ? supabaseKey.substring(0, 30) + '...' : '없음');

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ 환경변수가 설정되지 않았습니다');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function query6_2Data() {
  try {
    console.log('\n📊 6/2 데이터 조회 중...\n');

    // 1. 6/2에 측정된 모든 stats 조회
    const { data: stats, error: statsError } = await supabase
      .from('post_daily_stats')
      .select('post_id, measured_at, play_count, likes_count, comments_count')
      .gte('measured_at', '2026-06-02')
      .lt('measured_at', '2026-06-03');

    if (statsError) {
      console.error('❌ Stats 조회 오류:', statsError);
      return;
    }

    console.log(`📈 6/2에 측정된 데이터: ${stats.length}개\n`);

    if (stats.length === 0) {
      console.log('⚠️ 6/2 데이터가 없습니다');
      return;
    }

    // 2. play_count 합계 계산
    const totalPlayCount = stats.reduce((sum, s) => sum + (s.play_count || 0), 0);
    console.log(`📊 합계 조회수 (누적값): ${totalPlayCount.toLocaleString()}\n`);

    // 3. 게시물별 데이터
    const postStats = {};
    stats.forEach(s => {
      if (!postStats[s.post_id]) postStats[s.post_id] = [];
      postStats[s.post_id].push(s);
    });

    console.log('📌 게시물별 6/2 데이터:\n');
    
    const postIds = Object.keys(postStats);
    for (const postId of postIds) {
      const post = postStats[postId];
      console.log(`   Post ${postId.substring(0, 8)}...`);
      post.forEach(s => {
        console.log(`     - 조회수: ${s.play_count}`);
      });
    }

    // 4. 상위 5개 조회수
    console.log('\n🔝 상위 5개 (play_count 기준):\n');
    const sorted = stats
      .sort((a, b) => (b.play_count || 0) - (a.play_count || 0))
      .slice(0, 5);

    sorted.forEach((s, i) => {
      console.log(`${i + 1}. 조회수: ${s.play_count?.toLocaleString()} (Post: ${s.post_id.substring(0, 8)}...)`);
    });

    // 5. 6/1 데이터와 비교
    console.log('\n\n📊 6/1과 6/2 비교:\n');
    
    const { data: stats6_1, error: error6_1 } = await supabase
      .from('post_daily_stats')
      .select('post_id, measured_at, play_count')
      .gte('measured_at', '2026-06-01')
      .lt('measured_at', '2026-06-02');

    if (!error6_1) {
      const total6_1 = stats6_1.reduce((sum, s) => sum + (s.play_count || 0), 0);
      const total6_2 = totalPlayCount;
      const diff = total6_2 - total6_1;
      
      console.log(`6/1 총 조회수 (누적): ${total6_1.toLocaleString()}`);
      console.log(`6/2 총 조회수 (누적): ${total6_2.toLocaleString()}`);
      console.log(`증분: ${diff.toLocaleString()}`);
      console.log(`증가율: ${((diff / total6_1) * 100).toFixed(1)}%`);
    }

  } catch (err) {
    console.error('❌ 오류:', err.message);
  }
}

query6_2Data();
