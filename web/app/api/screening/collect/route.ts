import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

async function fetchInstagramProfile(username: string, apiToken: string) {
  try {
    const { ApifyClient } = await import("apify-client");
    const client = new ApifyClient({ token: apiToken });

    const run = await client.actor("apify/instagram-scraper").call({
      usernames: [username],
      resultsType: "details",
      resultsLimit: 1,
    });

    const items = await client.dataset(run.defaultDatasetId).listItems();
    if (items.items.length === 0) return null;

    const profile = items.items[0];
    return {
      followers: profile.followersCount || 0,
      following: profile.followingCount || 0,
      posts: profile.postsCount || 0,
      avgEngagementRate: profile.avgEngagementRate || 0,
      avgLikesPerPost: profile.avgLikesPerPost || 0,
      avgCommentsPerPost: profile.avgCommentsPerPost || 0,
    };
  } catch (error) {
    console.error(`[ERROR] Failed to fetch Instagram profile for ${username}:`, error);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET;

    // 인증 확인
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

    // 1. influencers 테이블에서 모든 인플루언서 가져오기
    console.log("[LOG] Fetching influencers...");
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

    console.log(`[LOG] Found ${influencers.length} influencers`);

    // 2. 각 인플루언서의 Instagram 프로필 데이터 수집
    const metrics = [];
    const today = new Date().toISOString().split("T")[0];

    for (const influencer of influencers) {
      // Instagram URL에서 username 추출
      const match = influencer.url.match(/instagram\.com\/([^/?]+)/);
      if (!match) {
        console.warn(`[WARN] Could not extract username from ${influencer.url}`);
        continue;
      }

      const username = match[1];
      console.log(`[LOG] Collecting metrics for @${username}...`);

      // Apify로 프로필 데이터 수집
      const profile = await fetchInstagramProfile(username, apiToken);
      if (!profile) {
        console.warn(`[WARN] Failed to collect metrics for @${username}`);
        continue;
      }

      // followers 데이터만 저장 (나머지는 나중에 확장 가능)
      metrics.push({
        influencer_id: influencer.id,
        followers: profile.followers,
        run_at: new Date().toISOString(),
      });
    }

    console.log(`[LOG] Collected metrics for ${metrics.length} influencers`);

    // 3. screening_metrics 테이블에 저장
    if (metrics.length > 0) {
      const { error: insertError } = await supabase
        .from("screening_metrics")
        .insert(metrics);

      if (insertError) {
        console.error("[ERROR] Failed to insert screening metrics:", insertError);
        throw new Error(`Failed to save metrics: ${insertError.message}`);
      }
    }

    return NextResponse.json({
      success: true,
      message: "Screening metrics collected",
      collected: metrics.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[ERROR] Screening collection failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
