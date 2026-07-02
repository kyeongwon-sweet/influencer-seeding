import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// 최근 추가된 게시물 20건 — 모바일 추가 화면(/quick-add) 히스토리용 경량 조회.
// (무거운 기본 GET /api/sponsored-posts 전체 페이로드를 쓰지 않도록 별도 분리.)
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const cols = "id, url, channel_type, content_summary, posted_at, created_at, created_by";
  const { data, error } = await supabase
    .from("sponsored_posts")
    .select(cols)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    // created_by 컬럼이 아직 없는 환경에서도 동작하도록 그 컬럼만 빼고 재시도.
    const retry = await supabase
      .from("sponsored_posts")
      .select("id, url, channel_type, content_summary, posted_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (retry.error) return NextResponse.json({ error: retry.error.message }, { status: 500 });
    return NextResponse.json(retry.data ?? [], { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(data ?? [], { headers: { "Cache-Control": "no-store" } });
}
