import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * 저장된 모든 sponsored_posts.url 을 normalizeUrl 형태(끝슬래시 포함·쿼리 제거)로 통일.
 * 관리자(Clerk 로그인) 전용. 전용 경로라 GET 캐시/로그인 리다이렉트 영향 없음.
 *
 * GET /api/admin/normalize-urls  → 정규화 실행, {updated, total, skipped, collision} 반환
 *
 * 충돌(이미 같은 정규화 URL이 존재)은 건너뜀 → unique 제약 위반 방지.
 */
export async function GET(_req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();

  // 전체 게시물 (페이지네이션 — 1000행 상한 대응)
  type P = { id: string; url: string };
  const posts: P[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("sponsored_posts").select("id, url").range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    posts.push(...((data ?? []) as P[]));
    if (!data || data.length < 1000) break;
  }

  const existing = new Set(posts.map(p => p.url));
  let updated = 0, skipped = 0, collision = 0;
  for (const p of posts) {
    const cleaned = normalizeUrl(p.url) || p.url;
    if (p.url === cleaned) { skipped++; continue; }
    if (existing.has(cleaned)) { collision++; continue; } // 이미 정규화형이 따로 존재 → 건너뜀
    const { error } = await supabase.from("sponsored_posts").update({ url: cleaned }).eq("id", p.id);
    if (error) { collision++; continue; } // unique 위반 등은 안전하게 건너뜀
    existing.delete(p.url); existing.add(cleaned);
    updated++;
  }

  return NextResponse.json(
    { message: `${updated}개 URL 정규화 완료`, updated, total: posts.length, already_normalized: skipped, collision_skipped: collision },
    { headers: { "Cache-Control": "no-store" } }
  );
}
