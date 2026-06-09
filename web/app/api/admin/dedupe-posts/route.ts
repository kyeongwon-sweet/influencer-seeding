import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 중복 게시물 정리 (정규화 URL 기준). 관리자(Clerk 로그인) 전용.
 *
 * GET /api/admin/dedupe-posts          → 미리보기(dry-run). 삭제 안 함.
 * GET /api/admin/dedupe-posts?confirm=1 → 실제 정리.
 *
 * 같은 normalizeUrl(url)로 묶이는 게시물이 2개 이상이면:
 *  - keeper 선정: 통계(post_daily_stats) 많은 것 → 정규화된 URL → 오래된 것 순
 *  - 패자 통계를 keeper에 "누락 날짜만" 병합(기존 값 유지) 후 패자 삭제(통계는 cascade)
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const confirm = req.nextUrl.searchParams.get("confirm") === "1";
  const supabase = getServerSupabase();

  // 1) 모든 게시물 (페이지네이션)
  type P = { id: string; url: string; created_at: string };
  const posts: P[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("sponsored_posts").select("id, url, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    posts.push(...((data ?? []) as P[]));
    if (!data || data.length < 1000) break;
  }

  // 2) 정규화 URL로 그룹핑 → 중복(2개 이상)만
  const groups = new Map<string, P[]>();
  for (const p of posts) {
    const key = normalizeUrl(p.url) || p.url;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }
  const dupGroups = [...groups.entries()].filter(([, arr]) => arr.length > 1);
  if (dupGroups.length === 0) {
    return NextResponse.json({ ok: true, dry_run: !confirm, duplicate_groups: 0, message: "중복 없음" });
  }

  // 3) 중복 그룹 게시물들의 통계 개수 집계
  const dupIds = dupGroups.flatMap(([, arr]) => arr.map(p => p.id));
  const statCount = new Map<string, number>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("post_daily_stats").select("post_id").in("post_id", dupIds).range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const s of (data ?? []) as { post_id: string }[]) statCount.set(s.post_id, (statCount.get(s.post_id) ?? 0) + 1);
    if (!data || data.length < 1000) break;
  }

  // 4) 그룹별 keeper/losers
  const plan = dupGroups.map(([key, arr]) => {
    const ranked = [...arr].sort((a, b) => {
      const sc = (statCount.get(b.id) ?? 0) - (statCount.get(a.id) ?? 0);
      if (sc !== 0) return sc;                          // 통계 많은 쪽 우선
      const aClean = a.url === key ? 1 : 0, bClean = b.url === key ? 1 : 0;
      if (bClean !== aClean) return bClean - aClean;    // 이미 정규화된 URL 우선
      return a.created_at < b.created_at ? -1 : 1;       // 오래된 것 우선
    });
    return { key, keep: ranked[0], losers: ranked.slice(1) };
  });

  if (!confirm) {
    return NextResponse.json({
      ok: true,
      dry_run: true,
      duplicate_groups: plan.length,
      posts_to_delete: plan.reduce((n, g) => n + g.losers.length, 0),
      sample: plan.slice(0, 20).map(g => ({
        url: g.key,
        keep: { id: g.keep.id, url: g.keep.url, stats: statCount.get(g.keep.id) ?? 0 },
        delete: g.losers.map(l => ({ id: l.id, url: l.url, stats: statCount.get(l.id) ?? 0 })),
      })),
      note: "이대로 정리하려면 끝에 ?confirm=1 을 붙여 다시 호출하세요.",
    });
  }

  // 5) 실행: 패자 통계를 keeper로 누락 날짜만 병합 → 패자 삭제
  let deleted = 0, mergedStats = 0;
  for (const g of plan) {
    for (const loser of g.losers) {
      const { data: ls } = await supabase
        .from("post_daily_stats")
        .select("measured_at, play_count, likes_count, comments_count")
        .eq("post_id", loser.id);
      if (ls && ls.length) {
        const rows = (ls as Array<Record<string, unknown>>).map(s => ({
          post_id: g.keep.id,
          measured_at: s.measured_at,
          play_count: s.play_count,
          likes_count: s.likes_count,
          comments_count: s.comments_count,
        }));
        const { data: ins } = await supabase
          .from("post_daily_stats")
          .upsert(rows, { onConflict: "post_id,measured_at", ignoreDuplicates: true }) // keeper에 없는 날짜만 추가
          .select("id");
        mergedStats += (ins ?? []).length;
      }
      const { error: de } = await supabase.from("sponsored_posts").delete().eq("id", loser.id);
      if (de) return NextResponse.json({ error: de.message, deleted_so_far: deleted }, { status: 500 });
      deleted++;
    }
  }

  return NextResponse.json({ ok: true, dry_run: false, duplicate_groups: plan.length, deleted_posts: deleted, merged_stats: mergedStats });
}
