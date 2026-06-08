import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    // 2. URL에서 Instagram/YouTube 계정 추출 및 Apify 수집
    const { ApifyClient } = await import("apify-client");
    const client = new ApifyClient({ token: apiToken });

    const statsToInsert: Array<{
      post_id: string;
      measured_at: string;
      play_count: number | null;
      likes_count: number | null;
      comments_count: number | null;
    }> = [];

    const today = new Date().toISOString().split("T")[0];

    for (const post of posts) {
      try {
        let username: string | null = null;

        // Instagram URL 파싱
        if (post.url.includes("instagram.com")) {
          const match = post.url.match(/instagram\.com\/([^/?]+)/);
          username = match ? match[1] : null;
        }

        if (!username) {
          console.warn(`[WARN] 계정 파싱 실패: ${post.url}`);
          continue;
        }

        console.log(`[LOG] @${username} 데이터 수집 중...`);

        // Apify Instagram Scraper 호출
        const run = await client.actor("apify/instagram-scraper").call({
          usernames: [username],
          resultsType: "posts",
          resultsLimit: 50,
        });

        const items = await client.dataset(run.defaultDatasetId).listItems();
        const postItems = items.items || [];

        if (postItems.length === 0) {
          console.warn(`[WARN] @${username}의 게시물 없음`);
          continue;
        }

        // 게시물에서 조회수/좋아요/댓글 합계 계산
        let totalViews = 0;
        let totalLikes = 0;
        let totalComments = 0;

        for (const item of postItems) {
          totalViews += item.videoViewCount || item.viewCount || 0;
          totalLikes += item.likeCount || 0;
          totalComments += item.commentCount || 0;
        }

        if (totalViews === 0 && totalLikes === 0 && totalComments === 0) {
          console.warn(`[WARN] @${username}의 통계 없음`);
          continue;
        }

        statsToInsert.push({
          post_id: post.id,
          measured_at: today,
          play_count: totalViews > 0 ? totalViews : null,
          likes_count: totalLikes > 0 ? totalLikes : null,
          comments_count: totalComments > 0 ? totalComments : null,
        });

        console.log(
          `[OK] @${username}: 조회=${totalViews}, 좋아요=${totalLikes}, 댓글=${totalComments}`
        );
      } catch (apifyError) {
        console.warn(`[WARN] @${post.account_name} 수집 실패:`, apifyError);
        continue;
      }
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
