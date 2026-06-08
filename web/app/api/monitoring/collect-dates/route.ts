import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 특정 날짜의 협찬 게시물 실시간 데이터 수집
 * POST /api/monitoring/collect-dates
 * body: { dates: ["2026-06-06", "2026-06-07", "2026-06-08"] }
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET;

    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { dates } = (await req.json()) as { dates?: string[] };
    const targetDates = dates || ["2026-06-06", "2026-06-07", "2026-06-08"];

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log(`[LOG] 협찬 게시물 데이터 수집 시작: ${targetDates.join(", ")}`);

    // 1. 해당 날짜에 업로드된 협찬 게시물 조회
    const { data: posts, error: postsError } = await supabase
      .from("sponsored_posts")
      .select("id, url, posted_at, account_name")
      .in(
        "posted_at",
        targetDates.map((d) => `${d}%`)
      );

    if (postsError) {
      throw new Error(`Failed to fetch posts: ${postsError.message}`);
    }

    if (!posts || posts.length === 0) {
      console.log("[WARN] 해당 날짜의 게시물 없음");
      return NextResponse.json({
        success: true,
        message: "No posts found for the specified dates",
        collected: 0,
      });
    }

    console.log(`[LOG] 발견된 게시물: ${posts.length}개`);

    // 2. 각 게시물의 현재 통계 조회 (Apify 사용)
    const apifyToken = process.env.APIFY_API_TOKEN;
    if (!apifyToken) {
      return NextResponse.json(
        { error: "APIFY_API_TOKEN not configured" },
        { status: 500 }
      );
    }

    const statsToInsert: Array<{
      post_id: string;
      measured_at: string;
      play_count: number | null;
      likes_count: number | null;
      comments_count: number | null;
    }> = [];

    for (const post of posts) {
      try {
        // Instagram 또는 YouTube URL 파싱
        let username: string | null = null;
        let isYoutube = false;

        if (post.url.includes("instagram.com")) {
          const match = post.url.match(/instagram\.com\/([^/?]+)/);
          username = match ? match[1] : null;
        } else if (post.url.includes("youtube.com") || post.url.includes("youtu.be")) {
          isYoutube = true;
        }

        if (!username && !isYoutube) {
          console.warn(`[WARN] URL 파싱 실패: ${post.url}`);
          continue;
        }

        const measuredAt = post.posted_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);

        // Instagram 데이터 수집 (Apify)
        if (username && !isYoutube) {
          try {
            const { ApifyClient } = await import("apify-client");
            const client = new ApifyClient({ token: apifyToken });

            const run = await client.actor("apify/instagram-scraper").call({
              usernames: [username],
              resultsType: "details",
              resultsLimit: 1,
            });

            const items = await client.dataset(run.defaultDatasetId).listItems();
            const profile = items.items[0];

            if (profile) {
              statsToInsert.push({
                post_id: post.id,
                measured_at: measuredAt,
                play_count: profile.videoViewCount || null,
                likes_count: profile.likeCount || null,
                comments_count: profile.commentCount || null,
              });

              console.log(
                `[OK] @${username}: 조회=${profile.videoViewCount}, 좋아요=${profile.likeCount}, 댓글=${profile.commentCount}`
              );
            }
          } catch (apifyError) {
            console.warn(`[WARN] Apify 요청 실패 (@${username}):`, apifyError);
            continue;
          }
        }
      } catch (error) {
        console.warn(`[WARN] 게시물 처리 실패 (${post.id}):`, error);
      }
    }

    // 3. Supabase에 저장
    if (statsToInsert.length > 0) {
      console.log(`[LOG] ${statsToInsert.length}건의 통계 저장 중...`);

      const { error: insertError } = await supabase
        .from("post_daily_stats")
        .upsert(statsToInsert, {
          onConflict: "post_id,measured_at",
        });

      if (insertError) {
        throw new Error(`Failed to insert stats: ${insertError.message}`);
      }

      console.log(`[SUCCESS] 데이터 수집 완료: ${statsToInsert.length}건`);
    }

    return NextResponse.json({
      success: true,
      message: "Data collection completed",
      posts_found: posts.length,
      stats_collected: statsToInsert.length,
      dates: targetDates,
    });
  } catch (error) {
    console.error("[ERROR] Data collection failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
