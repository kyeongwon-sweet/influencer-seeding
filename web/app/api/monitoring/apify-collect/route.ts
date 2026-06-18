import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createApifyClient } from "@/lib/apify";
import { notifyJob } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 300;

// 인스타 shortcode 추출 — Apify는 /reel/을 /p/로 반환하므로 전체 URL이 아닌 shortcode로 매칭
function igShortcode(url: string): string | null {
  const m = (url || "").match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

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
      .select("id, account_name, url, posted_at, ended_at");

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

    let endedMarked = 0;

    // KST 기준 오늘 날짜 (UTC-09:00 보정)
    const now = new Date();
    const kstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const today = kstNow.toISOString().split("T")[0];

    // Instagram 게시물만 필터링 (이미 '종료(ended_at)' 처리된 글은 수집 제외 — 비용↓, 0 노이즈 제거)
    // ⚠️ shortcode 없는 프로필형 URL(.../username/reels/)은 제외 — 액터가 계정 게시물을 통째로 긁어 과수집됨
    const igPosts = posts.filter((p) => p.url.includes("instagram.com") && !p.ended_at && igShortcode(p.url));

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
        resultsLimit: igPosts.length, // 전체 게시물 수집 (100 고정 시 100개 초과분 누락)
        addParentData: true,
        maxRequestRetries: 3,
        proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] }, // 인스타 차단 회피 → 릴스 조회수 수집
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

        const sc = igShortcode(item.url);
        if (!sc) continue;
        const views = item.videoPlayCount || item.videoViewCount || item.impressions || item.viewCount || item.count || 0;
        const likes = item.likesCount || item.likeCount || 0;
        const comments = item.commentsCount || item.commentCount || item.comments || 0;

        urlToStats[sc] = { views, likes, comments };
      }

      // 직전(today 이전) 마지막 조회수·날짜 — 누적 단조성 검증 + 자동 '종료' 감지용
      // (전체 페이지네이션: 1000행 상한으로 오래된 글이 누락되면 감지가 안 되므로 전부 조회)
      const lastKnownPlay = new Map<string, number>();
      const lastMeasuredAt = new Map<string, string>();
      for (let from = 0; ; from += 1000) {
        const { data: page } = await supabase
          .from("post_daily_stats")
          .select("post_id, play_count, measured_at")
          .lt("measured_at", today)
          .order("measured_at", { ascending: false })
          .range(from, from + 999);
        for (const s of page || []) {
          if (!lastKnownPlay.has(s.post_id)) lastKnownPlay.set(s.post_id, s.play_count ?? 0);
          if (!lastMeasuredAt.has(s.post_id)) lastMeasuredAt.set(s.post_id, s.measured_at);
        }
        if (!page || page.length < 1000) break;
      }

      let skipped = 0;

      // 각 게시물별로 개별 데이터 저장
      for (const post of igPosts) {
        const cleanUrl = post.url.split("?")[0];
        const sc = igShortcode(post.url);

        // 🛡️ 재발방지: Apify 미반환 → 0으로 덮어쓰지 않고 건너뜀 (화면은 직전 값 유지)
        // 매칭은 shortcode 기준 (Apify가 /reel/을 /p/로 반환 → 전체 URL 매칭은 실패)
        if (!sc || !(sc in urlToStats)) {
          console.warn(`[SKIP] Apify 미반환: ${cleanUrl} (post_id=${post.id.substring(0, 8)}) → 0 저장 안 함`);
          skipped++;
          continue;
        }
        const stats = urlToStats[sc];

        // 🛡️ 재발방지: 누적 조회수 감소 = 수집 오류 → 저장 안 함
        const prevPlay = lastKnownPlay.get(post.id);
        if (prevPlay != null && stats.views < prevPlay) {
          console.warn(`[SKIP] 조회수 감소 (기존: ${prevPlay}, 신규: ${stats.views}): ${cleanUrl} → 저장 안 함`);
          skipped++;
          continue;
        }

        statsToInsert.push({
          post_id: post.id,
          measured_at: today,
          play_count: stats.views > 0 ? stats.views : 0,
          likes_count: stats.likes > 0 ? stats.likes : 0,
          comments_count: stats.comments > 0 ? stats.comments : 0,
        });

        console.log(
          `[OK] ${cleanUrl.split("/").slice(-2).join("/")} (post_id=${post.id.substring(0, 8)}...): 조회=${stats.views}, 좋아요=${stats.likes}, 댓글=${stats.comments}`
        );
      }

      if (skipped > 0) {
        console.warn(`[WARN] ${skipped}개 게시물 저장 제외 (미반환/조회수 감소)`);
      }

      // 🛑 자동 '종료' 감지: 이전 조회수>0였는데 ENDED_DAYS일째 Apify 미반환 → 삭제 추정.
      //    ended_at 기록(데이터는 보존, 향후 수집 제외). 일시적 스크랩 실패 오탐 방지를 위해 7일 기준.
      const ENDED_DAYS = 7;
      for (const post of igPosts) {
        const cleanUrl = post.url.split("?")[0];
        if (cleanUrl in urlToStats) continue; // 오늘 정상 수집됨 → 살아있음
        const prevPlay = lastKnownPlay.get(post.id);
        const last = lastMeasuredAt.get(post.id);
        if (!prevPlay || prevPlay <= 0 || !last) continue; // 이전 실데이터 없으면 종료 판단 안 함
        const gapDays = Math.floor((Date.parse(today) - Date.parse(last)) / 86400000);
        if (gapDays < ENDED_DAYS) continue;
        const { error: endErr } = await supabase
          .from("sponsored_posts").update({ ended_at: last }).eq("id", post.id);
        if (!endErr) {
          endedMarked++;
          console.warn(`[ENDED] ${cleanUrl} (post_id=${post.id.substring(0, 8)}): ${gapDays}일째 미반환 → 종료 처리(ended_at=${last})`);
        }
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

    await notifyJob("협찬 모니터링", "ok", `${statsToInsert.length}건 수집${endedMarked ? `, 종료 처리 ${endedMarked}건` : ""} (${today})`);
    return NextResponse.json({
      success: true,
      message: "Apify data collection completed",
      posts_processed: posts.length,
      stats_collected: statsToInsert.length,
      ended_marked: endedMarked,
      measured_at: today,
    });
  } catch (error) {
    console.error("[ERROR] Apify 수집 실패:", error);
    await notifyJob("협찬 모니터링", "fail", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Vercel 크론은 GET으로 호출 → POST-only면 405로 조용히 실패(자정 수집 누락 원인).
// GET=POST 별칭으로 정시 실행 보장.
export const GET = POST;
