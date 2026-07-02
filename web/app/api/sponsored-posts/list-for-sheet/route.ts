import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";

// 시트 Apps Script가 'DB→시트 주기 반영'(대시보드 추가분을 시트로 가져오기)을 위해 호출하는 경량 조회 라우트.
// sponsored_posts 메타만 반환(일자별 통계 제외 → 가벼움). 인증: Authorization: Bearer <CRON_SECRET> (bulk/stats-import과 동일).
export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  const posts: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sponsored_posts")
      .select(
        "url, posted_at, account_name, company_name, content_summary, channel_type, project_name, product_name, cost, ended_at"
      )
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const p of data ?? []) posts.push(p);
    if (!data || data.length < PAGE) break;
  }

  return NextResponse.json({ posts }, { headers: { "Cache-Control": "no-store" } });
}
