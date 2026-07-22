import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createApifyClient } from "@/lib/apify";
import { checkCronAuth } from "@/lib/cron-auth";
import { isBannerChannelType } from "@/lib/banner-metric";

export const runtime = "nodejs";
export const maxDuration = 300;

// 인스타 shortcode 추출 — Apify는 /reel/을 /p/로 반환하므로 전체 URL이 아닌 shortcode로 매칭
function igShortcode(url: string): string | null {
  const m = (url || "").match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * 협찬 게시물 즉시 수집 (수동 트리거)
 * GET/POST /api/monitoring/collect-now?date=2026-06-08 (선택)
 * ⚠️ CRON_SECRET Bearer 인증 필수 — 무인증 시 외부에서 전체 Apify 스크랩을 트리거해 월 예산 고갈 가능.
 *    수동 실행: curl -H "Authorization: Bearer $CRON_SECRET" ".../collect-now?date=..."
 * @note Vercel deployment verified with apify-client dependency
 */
export async function GET(req: NextRequest) {
  return collect(req);
}

export async function POST(req: NextRequest) {
  return collect(req);
}

async function collect(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
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

    console.log("[LOG] 🚀 수동 협찬 게시물 데이터 수집 시작");

    // 1. 모든 협찬 게시물 조회
    const { data: posts, error: postsError } = await supabase
      .from("sponsored_posts")
      .select("id, account_name, url, posted_at, channel_type");

    if (postsError) {
      throw new Error(`Failed to fetch posts: ${postsError.message}`);
    }

    if (!posts || posts.length === 0) {
      return NextResponse.json({
        success: true,
        message: "협찬 게시물 없음",
        collected: 0,
      });
    }

    console.log(`[LOG] ✅ 발견된 협찬 게시물: ${posts.length}개`);

    // 2. 수집 날짜 결정
    const dateParam = req.nextUrl.searchParams.get("date");
    let measuredAt = dateParam;

    if (!measuredAt) {
      const now = new Date();
      const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      measuredAt = kstNow.toISOString().split("T")[0];
    }

    console.log(`[LOG] 📅 수집 날짜: ${measuredAt}`);
    const eligiblePosts = posts.filter((p) => {
      const postedAt = p.posted_at ? String(p.posted_at).slice(0, 10) : null;
      return !postedAt || postedAt <= measuredAt!;
    });
    const prePostedSkipped = posts.length - eligiblePosts.length;
    if (prePostedSkipped > 0) {
      console.warn(`[WARN] pre-upload posts skipped: ${prePostedSkipped} (measured_at=${measuredAt})`);
    }

    // 3. directUrls를 사용해서 개별 게시물별 조회수 수집
    const client = createApifyClient();

    const statsToInsert: Array<{
      post_id: string;
      measured_at: string;
      play_count: number | null;
      likes_count: number | null;
      comments_count: number | null;
    }> = [];

    // Instagram 게시물만 필터링
    // ⚠️ shortcode 없는 프로필형 URL(.../username/reels/)은 제외 — 액터가 계정 게시물을 통째로 긁어 과수집됨
    const igPosts = eligiblePosts.filter((p) => p.url.includes("instagram.com") && igShortcode(p.url));

    if (igPosts.length === 0) {
      return NextResponse.json({
        success: true,
        message: "Instagram 게시물 없음",
        collected: 0,
      });
    }

    console.log(`[LOG] 🎬 Instagram 게시물: ${igPosts.length}개 (Apify 수집 중...)`);

    try {
      // directUrls로 모든 게시물을 한 번에 수집 (실제 조회수만)
      const run = await client.actor("apify/instagram-scraper").call({
        directUrls: igPosts.map((p) => p.url),
        resultsType: "posts",
        resultsLimit: igPosts.length, // 전체 게시물 수집 (100 고정 시 100개 초과분 누락)
        addParentData: true,
        maxRequestRetries: 3,
        proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] }, // 인스타 차단 회피 → 릴스 조회수 수집
      });

      const items = await client.dataset(run.defaultDatasetId).listItems();
      const resultItems = (items.items || []) as any[]; // Apify 외부 JSON — 필드 동적

      console.log(`[LOG] 📊 Apify 응답: ${resultItems.length}개 게시물`);

      // URL → 조회수 매핑
      const urlToStats: Record<
        string,
        { views: number; likes: number; comments: number }
      > = {};

      for (const item of resultItems) {
        if (item.error) {
          console.warn(`   ⚠️ Apify ERROR: ${item.url} → ${item.error}`);
          continue;
        }

        const url = (item.url || "").split("?")[0];
        const sc = igShortcode(item.url);
        const views = item.videoPlayCount || item.videoViewCount || item.impressions || item.viewCount || item.count || 0;
        const likes = item.likesCount || item.likeCount || 0;
        const comments = item.commentsCount || item.commentCount || item.comments || 0;

        // 🔍 음수 조회수 감지 (Apify 버그 추적)
        if (views < 0) {
          console.error(
            `   🔴 NEGATIVE VIEWS DETECTED: ${url}`
          );
          console.error(
            `      Raw Apify data: videoViewCount=${item.videoViewCount}, viewCount=${item.viewCount}`
          );
          console.error(
            `      All fields: ${JSON.stringify(item, null, 2)}`
          );
        }

        if (sc) urlToStats[sc] = { views, likes, comments };
      }

      // 4️⃣ 직전(measuredAt 이전) 마지막 조회수 — 누적 단조성 검증용
      // ⚠️ 전체 테이블 단일 쿼리는 1000행 상한에 잘려 오래된 게시물 직전값이 누락됨(가드 무력화)
      //    → apify-webhook과 동일하게 이번 배치 id만 청크 조회 + 페이지네이션 (최초 등장 = 최신)
      const lastKnownPlay = new Map<string, number>();
      {
        const batchIds = [...new Set(igPosts.map((p: { id: string }) => p.id).filter(Boolean))];
        const ID_CHUNK = 120, PAGE = 1000;
        for (let c = 0; c < batchIds.length; c += ID_CHUNK) {
          const idsChunk = batchIds.slice(c, c + ID_CHUNK);
          for (let from = 0; ; from += PAGE) {
            const { data: page } = await supabase
              .from("post_daily_stats")
              .select("post_id, play_count, measured_at")
              .in("post_id", idsChunk)
              .lt("measured_at", measuredAt)
              .order("measured_at", { ascending: false })
              .range(from, from + PAGE - 1);
            for (const s of page ?? []) {
              if (!lastKnownPlay.has(s.post_id)) lastKnownPlay.set(s.post_id, s.play_count ?? 0);
            }
            if (!page || page.length < PAGE) break;
          }
        }
      }

      let skipped = 0;

      // 5️⃣ 각 게시물별로 개별 데이터 저장 & 검증
      for (const post of igPosts) {
        const cleanUrl = post.url.split("?")[0];
        const sc = igShortcode(post.url);

        // 🛡️ 재발방지: Apify 미반환 → 0으로 덮어쓰지 않고 건너뜀. 매칭은 shortcode 기준(/reel/→/p/ 대응)
        if (!sc || !(sc in urlToStats)) {
          console.warn(`   ⏭️ Apify 미반환: ${cleanUrl} → 0 저장 안 함 (직전 값 유지)`);
          skipped++;
          continue;
        }
        const stats = urlToStats[sc];

        if (isBannerChannelType(post.channel_type)) {
          statsToInsert.push({
            post_id: post.id,
            measured_at: measuredAt,
            play_count: null,
            likes_count: stats.likes > 0 ? stats.likes : 0,
            comments_count: stats.comments > 0 ? stats.comments : 0,
          });
          continue;
        }

        // 🛡️ 재발방지: 누적 조회수 감소 = 수집 오류 → 저장 안 함
        const prevPlay = lastKnownPlay.get(post.id);
        if (prevPlay != null && stats.views < prevPlay) {
          console.warn(`   ⏭️ 누적 조회수 감소 (기존: ${prevPlay}, 신규: ${stats.views}): ${cleanUrl} → 저장 안 함`);
          skipped++;
          continue;
        }

        statsToInsert.push({
          post_id: post.id,
          measured_at: measuredAt,
          play_count: stats.views > 0 ? stats.views : 0,
          likes_count: stats.likes > 0 ? stats.likes : 0,
          comments_count: stats.comments > 0 ? stats.comments : 0,
        });

        console.log(
          `   ✓ ${cleanUrl.split("/").slice(-2).join("/")} → 조회=${stats.views}, 좋아요=${stats.likes}, 댓글=${stats.comments}`
        );
      }

      if (skipped > 0) {
        console.warn(`[WARN] ⏭️ ${skipped}개 게시물 저장 제외 (미반환/조회수 감소)`);
      }
    } catch (apifyError) {
      console.error("[ERROR] Apify 수집 실패:", apifyError);
      throw new Error(
        `Apify collection failed: ${apifyError instanceof Error ? apifyError.message : "Unknown error"}`
      );
    }

    // 4. Supabase에 저장
    if (statsToInsert.length > 0) {
      console.log(`[LOG] 💾 ${statsToInsert.length}개 행 저장 중...`);

      const { error: insertError } = await supabase
        .from("post_daily_stats")
        .upsert(statsToInsert, {
          onConflict: "post_id,measured_at",
        });

      if (insertError) {
        console.error("[ERROR] 저장 실패:", insertError);
        throw new Error(`Failed to save stats: ${insertError.message}`);
      }

      console.log(`[SUCCESS] ✅ 데이터 수집 완료: ${statsToInsert.length}개행`);
    }

    return NextResponse.json({
      success: true,
      message: `✅ ${measuredAt} 데이터 수집 완료!`,
      posts_found: posts.length,
      pre_posted_skipped: prePostedSkipped,
      instagram_posts: igPosts.length,
      stats_collected: statsToInsert.length,
      measured_at: measuredAt,
    });
  } catch (error) {
    console.error("[ERROR] 수집 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
