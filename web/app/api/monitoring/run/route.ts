import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET;

    // 인증 확인
    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Supabase 초기화
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // sponsored_posts 조회
    const { data: posts, error: postsError } = await supabase
      .from("sponsored_posts")
      .select("id, url, posted_at, account_name, influencer_id")
      .order("created_at", { ascending: false })
      .limit(100);

    if (postsError) {
      throw new Error(`Supabase error: ${postsError.message}`);
    }

    return NextResponse.json({
      success: true,
      message: "Monitoring completed",
      postCount: posts?.length ?? 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[ERROR] Monitoring failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
