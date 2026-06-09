import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createApifyClient } from "@/lib/apify";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Apify를 사용해서 협찬 게시물의 실시간 조회수/좋아요/댓글 수집
 * POST /api/monitoring/apify-collect
 * Authorization: Bearer CRON_SECRET
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET;

    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const apiToken = process.env.APIFY_API_TOKEN;
    if (!apiToken) {
      return NextResponse.json(
        { error: "APIFY_API_TOKEN not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log("[LOG] Apify 협찬 게시물 데이터 수집 시작");

    // 1. 모든 협찬 게시물 조회
    const { data: posts, error: postsError } = await supabase
      .from("sponsored_posts")
      .select("id, account_name, url, posted_at");

    if (postsError) {
      throw new Error(`Failed to fetch posts: ${postsError.message}`);
    }

    if (!posts || posts.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No posts found",
        collected: 0,
      });
    }

    console.log(`[LOG] 발견된 협찬 게시물: ${posts.length}개`);

    // 2. directUrls를 사용해서 개별 게시물별 조회수 수집 (추정치 금지!)
    const client = createApifyClient();

    const statsToInsert: Array<{
      post_id: string;
      measured_at: string;
      play_count: number | null;
      likes_count: number | null;
      comments_count: number | null;
    }> = [];

    // KST 기준 오늘 날짜 (UTC-09:00 보정)
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = kstNow.toISOString().split("T")[0];

    // Instagram 게시물만 필터링
    const igPosts = posts.filter((p) => p.url.includes("instagram.com"));

    if (igPosts.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Instagram posts found",
        collected: 0,
      });
    }

    console.log(`[LOG] Instagram 게시물: ${igPosts.length}개 (directUrls로 수집)`);

    try {
      // directUrls로 모든 게시물을 한 번에 수집 (실제 조회수만)
      const run = await client.actor("apify/instagram-scraper").call({
        directUrls: igPosts.map((p) => p.url),
        resultsType: "posts",
        resultsLimit: 100,
        addParentData: true,
        maxRequestRetries: 1,
      });

      const items = await client.dataset(run.defaultDatasetId).listItems();
      const resultItems = items.items || [];

      console.log(`[LOG] Apify 응답: ${resultItems.length}개 게시물`);

      // URL → 조회수 매핑
      const urlToStats: Record<
        string,
        { views: number; likes: number; comments: number }
      > = {};

      for (const item of resultItems) {
        if (item.error) continue; // 에러 아이템 스킵

        const url = (item.url || "").split("?")[0];
        const views = item.videoViewCount || item.viewCount || 0;
        const likes = item.likeCount || 0;
        const comments = item.commentsCount || item.commentCount || 0;

        urlToStats[url] = { views, likes, comments };
      }

      // 각 게시물별로 개별 데이터 저장
      for (const post of igPosts) {
        const cleanUrl = post.url.split("?")[0];
        const stats = urlToStats[cleanUrl] || {
          views: 0,
          likes: 0,
          comments: 0,
        };

        statsToInsert.push({
          post_id: post.id,
          measured_at: today,
          play_count: stats.views > 0 ? stats.views : 0, // 0도 저장 (추정 금지)
          likes_count: stats.likes > 0 ? stats.likes : 0,
          comments_count: stats.comments > 0 ? stats.comments : 0,
        });

        console.log(
          `[OK] ${cleanUrl.split("/").slice(-2).join("/")} (post_id=${post.id.substring(0, 8)}...): 조회=${stats.views}, 좋아요=${stats.likes}, 댓글=${stats.comments}`
        );
      }
    } catch (apifyError) {
      console.error("[ERROR] Apify 수집 실패:", apifyError);
      throw new Error(
        `Apify collection failed: ${apifyError instanceof Error ? apifyError.message : "Unknown error"}`
      );
    }

    // 3. Supabase에 저장
    if (statsToInsert.length > 0) {
      console.log(`[LOG] ${statsToInsert.length}개 통계 저장 중...`);

      const { error: insertError } = await supabase
        .from("post_daily_stats")
        .upsert(statsToInsert, {
          onConflict: "post_id,measured_at",
        });

      if (insertError) {
        console.error("[ERROR] 저장 실패:", insertError);
        throw new Error(`Failed to save stats: ${insertError.message}`);
      }

      console.log(`[SUCCESS] 데이터 수집 완료: ${statsToInsert.length}개`);
    }

    return NextResponse.json({
      success: true,
      message: "Apify data collection completed",
      posts_processed: posts.length,
      stats_collected: statsToInsert.length,
      measured_at: today,
    });
  } catch (error) {
    console.error("[ERROR] Apify 수집 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
