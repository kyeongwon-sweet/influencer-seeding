import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// 홈 '오늘의 인사이트' 전용 경량 요약 — 조회수/댓글 급상승 top3만 서버에서 계산해 작은 JSON으로 반환.
//
// ⚠️ 재발 방지 (중요): 홈은 원래 /api/sponsored-posts(전 게시물 + 전체 통계 1만+행, 3.5MB, ~10초)를
//    통째로 받아 클라이언트에서 gainers를 계산했다. 이 응답이 느려서 홈의 12초 abort와 레이스가 나고,
//    자주 빈 배열이 되어 인사이트가 '특이사항 없음'으로 오표시됐다(2026-07-01 .in_() 0행 버그도 같은 뿌리).
//    → 여기서 급상승 판정에 필요한 최소치(최근 며칠 통계)만 조회·집계해 ~1KB로 반환한다.
//    금지: id 목록 .in_()(URL 한도로 0행), 전체 이력 조회(느림). 데이터가 늘어도 창(WINDOW_DAYS)이 고정이라 느려지지 않는다.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();

  // 게시물 메타(경량: id·url·account_name만) — 전량 페이지네이션
  const meta = new Map<string, { url: string | null; account_name: string | null }>();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("sponsored_posts")
        .select("id, url, account_name")
        .range(from, from + PAGE - 1);
      if (error) break; // graceful: 메타 일부 실패해도 있는 것으로 진행
      for (const p of data ?? []) meta.set(p.id, { url: p.url, account_name: p.account_name });
      if (!data || data.length < PAGE) break;
    }
  }

  // 최근 통계만 (급상승 = 최신 2개 비교 → 창 하나면 충분). 전체 이력은 조회하지 않는다.
  const WINDOW_DAYS = 7;
  const since = new Date(Date.now() - WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  const byPost = new Map<string, { measured_at: string; play_count: number | null; comments_count: number | null }[]>();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("post_daily_stats")
        .select("post_id, measured_at, play_count, comments_count")
        .gte("measured_at", since)
        .order("measured_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) break;
      for (const s of data ?? []) {
        const arr = byPost.get(s.post_id) ?? [];
        arr.push(s);
        byPost.set(s.post_id, arr);
      }
      if (!data || data.length < PAGE) break;
    }
  }

  type Gain = { id: string; url: string | null; account_name: string | null; delta: number };
  const viewGainers: Gain[] = [];
  const commentGainers: Gain[] = [];

  for (const [pid, rows] of byPost) {
    const m = meta.get(pid);
    if (!m) continue;
    // 과거→현재 정렬
    const asc = rows.slice().sort((a, b) =>
      a.measured_at < b.measured_at ? -1 : a.measured_at > b.measured_at ? 1 : 0
    );
    // 조회수 누적 단조 보정(감소는 직전 최대로 clamp) — 대시보드 다른 곳과 동일 규칙
    let maxPlay = 0;
    const mono = asc.map((s) => {
      const play = s.play_count != null ? Math.max(maxPlay, Number(s.play_count)) : maxPlay;
      maxPlay = play;
      return { play, comments: s.comments_count };
    });
    if (mono.length < 2) continue;
    const latest = mono[mono.length - 1];
    const prev = mono[mono.length - 2];

    const vd = latest.play - prev.play;
    if (vd > 0) viewGainers.push({ id: pid, url: m.url, account_name: m.account_name, delta: vd });

    const cd = (latest.comments ?? 0) - (prev.comments ?? 0);
    if (cd > 0) commentGainers.push({ id: pid, url: m.url, account_name: m.account_name, delta: cd });
  }

  viewGainers.sort((a, b) => b.delta - a.delta);
  commentGainers.sort((a, b) => b.delta - a.delta);

  return NextResponse.json(
    { viewGainers: viewGainers.slice(0, 3), commentGainers: commentGainers.slice(0, 3) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
