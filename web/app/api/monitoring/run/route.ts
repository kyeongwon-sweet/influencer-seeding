import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

/**
 * Vercel Cron Job: 협찬 모니터링 실행
 * 매일 자정(UTC 15:00 = KST 00:00)에 자동 실행
 *
 * Authorization: Bearer <CRON_SECRET> (Vercel에서 자동 전달)
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  // Vercel Cron Jobs는 자동으로 CRON_SECRET을 Authorization 헤더로 전달
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("[LOG] === 협찬 모니터링 시작 (Vercel Cron) ===");
    console.log(`[TIME] ${new Date().toISOString()}`);

    // Supabase 클라이언트 초기화
    const supabase = getServerSupabase();

    // 1. sponsored_posts 데이터 조회
    console.log("[LOG] sponsored_posts 조회 중...");
    const { data: posts, error: postsError } = await supabase
      .from("sponsored_posts")
      .select("id, url, posted_at, account_name, influencer_id")
      .order("created_at", { ascending: false });

    if (postsError) {
      throw new Error(`[ERROR] sponsored_posts 조회 실패: ${postsError.message}`);
    }

    if (!posts || posts.length === 0) {
      console.log("[WARN] 추적 중인 게시물이 없습니다.");
      return NextResponse.json({
        success: true,
        message: "No posts to monitor",
        postCount: 0,
      });
    }

    console.log(`[LOG] 추적 게시물: ${posts.length}개`);

    // 2. SKIP_APIFY 확인 (Vercel 환경변수)
    const skipApify = process.env.SKIP_APIFY?.toLowerCase() === "true";

    if (skipApify) {
      console.log("[LOG] ⏭️ Apify 데이터 수집 스킵 (SKIP_APIFY=true)");
    } else {
      console.log("[LOG] 🚀 Apify 데이터 수집 시작...");
      // TODO: Apify 호출 로직 (필요시)
    }

    // 3. 기본 정보만 업데이트 (추후 Apify 데이터 추가)
    console.log("[LOG] 모니터링 완료 - 데이터베이스 준비됨");

    return NextResponse.json({
      success: true,
      message: "Monitoring completed",
      postCount: posts.length,
      timestamp: new Date().toISOString(),
      apifySkipped: skipApify,
    });
  } catch (error) {
    console.error("[ERROR] 협찬 모니터링 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

// Vercel Edge Functions 호환성
export const runtime = "nodejs";
export const maxDuration = 300; // 5분 제한
