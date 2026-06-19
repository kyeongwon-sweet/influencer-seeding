import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APIFY_TOKEN = process.env.APIFY_API_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY || !APIFY_TOKEN) {
  console.error("❌ 환경변수 누락:", {
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_KEY: !!SUPABASE_KEY,
    APIFY_TOKEN: !!APIFY_TOKEN,
  });
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  console.log("📡 협찬 게시물 수집 시작...\n");

  // 1️⃣ Supabase에서 모든 협찬 게시물 가져오기
  const { data: posts, error: postsError } = await supabase
    .from("sponsored_posts")
    .select("id, url")
    .eq("is_deleted", false);

  if (postsError) {
    console.error("❌ Supabase 쿼리 실패:", postsError);
    process.exit(1);
  }

  if (!posts || posts.length === 0) {
    console.log("⚠️ 협찬 게시물이 없습니다");
    process.exit(0);
  }

  console.log(`✅ 수집 대상: ${posts.length}개 게시물`);
  console.log(`📝 URL 목록:`, posts.map(p => p.url).join("\n   "));
  console.log();

  // 2️⃣ Apify로 모든 URL 수집
  const urls = posts.map(p => p.url);
  const res = await fetch(
    "https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${APIFY_TOKEN}`,
      },
      body: JSON.stringify({
        directUrls: urls,
        resultsType: "posts",
        resultsLimit: urls.length,
        addParentData: true,
        maxRequestRetries: 1,
      }),
    }
  );

  const data = await res.json();

  if (!Array.isArray(data)) {
    console.error("❌ Apify 오류:", data);
    process.exit(1);
  }

  const collected = data.filter(d => !d.error);
  console.log(`🎯 Apify 수집: ${collected.length}/${urls.length}개 성공\n`);

  // 3️⃣ URL → 데이터 매핑
  const urlToData = {};
  for (const post of collected) {
    const url = (post.url || "").split("?")[0];
    const views = post.videoViewCount || post.viewCount || 0;
    const likes = post.likeCount || post.likesCount || 0;
    const comments = post.commentsCount || post.commentCount || post.comments || 0;

    urlToData[url] = { views, likes, comments };
    console.log(`  ${url.split("/").slice(-2).join("/")} → 조회수: ${views}, 좋아요: ${likes}, 댓글: ${comments}`);
  }

  console.log();

  // 4️⃣ post_daily_stats에 저장
  const today = "2026-06-08";
  const stats = [];

  for (const post of posts) {
    const cleanUrl = post.url.split("?")[0];
    const d = urlToData[cleanUrl] || { views: 0, likes: 0, comments: 0 };

    stats.push({
      post_id: post.id,
      measured_at: today,
      play_count: d.views,
      likes_count: d.likes,
      comments_count: d.comments,
    });
  }

  console.log(`💾 저장 대기: ${stats.length}개 행\n`);

  // 기존 데이터 삭제 (중복 방지)
  const { error: deleteError } = await supabase
    .from("post_daily_stats")
    .delete()
    .eq("measured_at", today);

  if (deleteError) {
    console.error("❌ 기존 데이터 삭제 실패:", deleteError);
    process.exit(1);
  }

  console.log(`🗑️ 기존 ${today} 데이터 삭제 완료`);

  // 새 데이터 저장
  const { error: insertError } = await supabase
    .from("post_daily_stats")
    .insert(stats);

  if (insertError) {
    console.error("❌ 데이터 저장 실패:", insertError);
    process.exit(1);
  }

  console.log(`✅ ${stats.length}개 행 저장 완료!`);
  console.log(`\n📊 6/8(${today}) 데이터 수집 완료! 대시보드에서 확인하세요.`);
})();
