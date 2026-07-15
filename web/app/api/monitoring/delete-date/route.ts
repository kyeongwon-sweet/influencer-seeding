import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkCronAuth } from "@/lib/cron-auth";

export const runtime = "nodejs";

/**
 * 특정 날짜의 협찬 게시물 통계 삭제 (데이터 수정용)
 * DELETE /api/monitoring/delete-date?date=2026-06-06
 * ⚠️ 파괴적 작업 → CRON_SECRET Bearer 인증 필수(무인증 외부 삭제 차단).
 */
export async function DELETE(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const dateParam = req.nextUrl.searchParams.get("date");

    if (!dateParam) {
      return NextResponse.json(
        { error: "date parameter required (format: 2026-06-06)" },
        { status: 400 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    console.log(`[LOG] 🗑️ ${dateParam} 데이터 삭제 중...`);

    const { error } = await supabase
      .from("post_daily_stats")
      .delete()
      .eq("measured_at", dateParam);

    if (error) {
      throw new Error(`Failed to delete: ${error.message}`);
    }

    console.log(`[SUCCESS] ✅ ${dateParam} 데이터 삭제 완료`);

    return NextResponse.json({
      success: true,
      message: `✅ ${dateParam} 데이터 삭제 완료!`,
      deleted_date: dateParam,
    });
  } catch (error) {
    console.error("[ERROR] 삭제 실패:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
