import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createApifyClient } from "@/lib/apify";
import { notifyJob } from "@/lib/slack";

export const runtime = "nodejs";
export const maxDuration = 300;

async function fetchInstagramMetrics(username: string) {
  try {
    const client = createApifyClient();

    console.log(`[LOG] @${username} 프로필 및 게시물 데이터 수집 중...`);

    // 1. 프로필 정보 수집
    const profileRun = await client.actor("apify/instagram-scraper").call({
      usernames: [username],
      resultsType: "details",
      resultsLimit: 1,
    });

    const profileItems = await client.dataset(profileRun.defaultDatasetId).listItems();
    if (profileItems.items.length === 0) return null;

    const profile = profileItems.items[0];
    const totalPosts = profile.postsCount || 0;
    const followers = profile.followersCount || 0;

    // 2. 게시물 데이터 수집 (최대 100개)
    const postsRun = await client.actor("apify/instagram-scraper").call({
      usernames: [username],
      resultsType: "posts",
      resultsLimit: 100,
    });

    const postsData = await client.dataset(postsRun.defaultDatasetId).listItems();
    const posts = postsData.items || [];

    console.log(`[LOG] @${username}: ${totalPosts} posts, ${posts.length} collected`);

    // 3. 게시물 통계 계산
    let totalViews = 0,
      totalLikes = 0,
      totalComments = 0,
      count1mView = 0;
    let videoDurations: number[] = [];

    for (const post of posts) {
      const views = post.viewsCount || 0;
      const likes = post.likesCount || 0;
      const comments = post.commentsCount || post.commentCount || 0;

      totalViews += views;
      totalLikes += likes;
      totalComments += comments;

      if (views >= 1000000) count1mView++;
      if (post.videoDuration) videoDurations.push(post.videoDuration);
    }

    const postCount = posts.length || 1;
    const avgViewCount = totalViews / postCount;
    const avgPlayCount = totalLikes / postCount; // Instagram의 경우 likes를 play_count로 봄
    const avgLikeRatio = posts.length > 0
      ? (posts.reduce((sum, p) => sum + (p.likesCount || 0), 0) / posts.length) / Math.max(1, avgViewCount) * 100
      : 0;
    const avgCommentRatio = posts.length > 0
      ? (posts.reduce((sum, p) => sum + (p.commentsCount || 0), 0) / posts.length) / Math.max(1, avgViewCount) * 100
      : 0;
    const avgViewsPerFollower = followers > 0 ? avgViewCount / followers : 0;
    const avgVideoDuration =
      videoDurations.length > 0
        ? videoDurations.reduce((a, b) => a + b, 0) / videoDurations.length
        : null;

    return {
      followers,
      total_posts: totalPosts,
      general_posts: postCount, // 일단 모두 일반 게시물로 분류
      ad_posts: 0, // 광고 게시물 분류는 별도 로직 필요
      total_avg_view_count: avgViewCount,
      general_avg_view_count: avgViewCount,
      ad_avg_view_count: null,
      total_avg_play_count: avgPlayCount,
      general_avg_play_count: avgPlayCount,
      ad_avg_play_count: null,
      avg_views_per_follower: avgViewsPerFollower,
      count_1m_view: count1mView,
      total_like_ratio: avgLikeRatio,
      general_like_ratio: avgLikeRatio,
      ad_like_ratio: null,
      total_comment_ratio: avgCommentRatio,
      general_comment_ratio: avgCommentRatio,
      ad_comment_ratio: null,
      avg_video_duration: avgVideoDuration,
      top_ad_play_count: null,
      top_ad_post_url: null,
    };
  } catch (error) {
    console.error(`[ERROR] Failed to fetch Instagram data for ${username}:`, error);
    return null;
  }
}

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

    console.log("[LOG] 스크리닝 메트릭스 수집 시작");

    // 1. influencers 테이블에서 모든 인플루언서 가져오기
    const { data: influencers, error: influencersError } = await supabase
      .from("influencers")
      .select("id, url")
      .eq("platform", "instagram");

    if (influencersError) {
      throw new Error(`Failed to fetch influencers: ${influencersError.message}`);
    }

    if (!influencers || influencers.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No influencers to collect metrics for",
        collected: 0,
      });
    }

    console.log(`[LOG] 발견된 인플루언서: ${influencers.length}명`);

    // 2. 각 인플루언서의 상세 메트릭스 수집
    const metrics = [];
    const runAt = new Date().toISOString();

    for (const influencer of influencers) {
      const match = influencer.url.match(/instagram\.com\/([^/?]+)/);
      if (!match) {
        console.warn(`[WARN] URL 파싱 실패: ${influencer.url}`);
        continue;
      }

      const username = match[1];
      const data = await fetchInstagramMetrics(username, apiToken);

      if (!data) {
        console.warn(`[WARN] @${username} 데이터 수집 실패`);
        continue;
      }

      metrics.push({
        influencer_id: influencer.id,
        run_at: runAt,
        followers: data.followers,
        total_posts: data.total_posts,
        general_posts: data.general_posts,
        ad_posts: data.ad_posts,
        total_avg_view_count: data.total_avg_view_count,
        general_avg_view_count: data.general_avg_view_count,
        ad_avg_view_count: data.ad_avg_view_count,
        total_avg_play_count: data.total_avg_play_count,
        general_avg_play_count: data.general_avg_play_count,
        ad_avg_play_count: data.ad_avg_play_count,
        avg_views_per_follower: data.avg_views_per_follower,
        count_1m_view: data.count_1m_view,
        total_like_ratio: data.total_like_ratio,
        general_like_ratio: data.general_like_ratio,
        ad_like_ratio: data.ad_like_ratio,
        total_comment_ratio: data.total_comment_ratio,
        general_comment_ratio: data.general_comment_ratio,
        ad_comment_ratio: data.ad_comment_ratio,
        avg_video_duration: data.avg_video_duration,
        top_ad_play_count: data.top_ad_play_count,
        top_ad_post_url: data.top_ad_post_url,
      });

      console.log(`[OK] @${username}: 팔로워=${data.followers}, 게시물=${data.total_posts}`);
    }

    console.log(`[LOG] ${metrics.length}명의 메트릭스 저장 중...`);

    // 3. screening_metrics 테이블에 저장
    if (metrics.length > 0) {
      const { error: insertError } = await supabase
        .from("screening_metrics")
        .upsert(metrics, { onConflict: "influencer_id,run_at" });

      if (insertError) {
        console.error("[ERROR] 저장 실패:", insertError);
        throw new Error(`Failed to save metrics: ${insertError.message}`);
      }
    }

    console.log(`[SUCCESS] 데이터 수집 완료: ${metrics.length}명`);

    await notifyJob("스크리닝", "ok", `${metrics.length}명 수집`);
    return NextResponse.json({
      success: true,
      message: "Screening metrics collected",
      collected: metrics.length,
      timestamp: runAt,
    });
  } catch (error) {
    console.error("[ERROR] 스크리닝 수집 실패:", error);
    await notifyJob("스크리닝", "fail", error instanceof Error ? error.message : "Unknown error");
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Vercel 크론은 GET으로 호출 → POST와 동일 처리 (body 미사용)
export const GET = POST;
