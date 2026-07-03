import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl } from "@/lib/url-utils";
import { logger } from "@/lib/logger";
import { normalizeChannelType } from "@/app/monitoring/lib";
import { triggerCaptionBackfill, needsCaption } from "@/lib/github-dispatch";

export async function GET(req: NextRequest) {
  // URL 정규화 마이그레이션 엔드포인트
  // (req.url 은 Vercel 런타임에서 쿼리가 누락될 수 있어 req.nextUrl 사용)
  if (req.nextUrl.searchParams.has('normalize')) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = getServerSupabase();

    // 모든 게시물 조회
    const { data: posts, error: fetchError } = await supabase
      .from("sponsored_posts")
      .select("id, url");

    if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });

    const postsArray = posts ?? [];
    let updatedCount = 0;

    // 각 게시물의 URL 정규화
    for (const post of postsArray) {
      const cleaned = normalizeUrl(post.url) || post.url;
      if (post.url !== cleaned) {
        const { error } = await supabase
          .from("sponsored_posts")
          .update({ url: cleaned })
          .eq("id", post.id);

        if (!error) updatedCount++;
      }
    }

    return NextResponse.json({
      message: `${updatedCount}개 URL 정규화 완료`,
      updated: updatedCount,
      total: postsArray.length
    });
  }

  // 기본 GET 요청
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();

  // sponsored_posts 조회 (influencer_id가 NULL이므로 조인 불가)
  // 게시물도 페이지네이션으로 전부 조회 (Supabase 기본 1000행 상한 우회 — 게시물 1000개 초과 시 누락 방지)
  const posts: any[] = [];
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data: page, error: postsError } = await supabase
        .from("sponsored_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      // graceful degrade: 한 페이지 조회가 실패해도 500으로 대시보드 전체를 죽이지 않고, 지금까지 모은 것으로 진행.
      if (postsError) { console.error("[sponsored-posts] posts 조회 실패:", postsError.message); break; }
      posts.push(...(page ?? []));
      if (!page || page.length < PAGE) break;
    }
  }

  // 모든 post_daily_stats를 페이지네이션으로 전부 조회 후 post별 그룹핑
  // (N+1 쿼리 방지 + Supabase 기본 1000행 상한으로 과거 데이터가 잘리는 문제 방지)
  const ids = (posts ?? []).map((p) => p.id);
  const statsByPost = new Map<string, any[]>();
  // ⚠️ .in("post_id", ids) 쓰지 말 것 — 게시물 수백 개면 id 목록이 쿼리 URL 한도를 넘어
  //    PostgREST가 0행을 반환(2026-07-01 확인). ids=전체 게시물이라 필터 불필요 → 전량 조회 후 post_id로 그룹핑.
  // 성능: select("*") 대신 필요한 컬럼만 + 순차 페이지네이션(왕복 N회) 대신 count 기반 병렬 조회로 로딩 단축.
  const PAGE = 1000;
  const STAT_COLS = "post_id, measured_at, play_count, likes_count, comments_count, created_at";
  const collect = (page: any[] | null | undefined) => {
    for (const s of page ?? []) {
      const arr = statsByPost.get(s.post_id) ?? [];
      arr.push(s);
      statsByPost.set(s.post_id, arr);
    }
  };
  if (ids.length > 0) {
    const { count, error: cntErr } = await supabase
      .from("post_daily_stats")
      .select("post_id", { count: "exact", head: true });
    if (cntErr || count == null) {
      // count 실패 시 순차 폴백(절단 방지) — 마지막 페이지가 가득 차면 계속 조회.
      if (cntErr) console.error("[sponsored-posts] stats count 실패, 순차 폴백:", cntErr.message);
      for (let from = 0; ; from += PAGE) {
        const { data: page, error } = await supabase.from("post_daily_stats").select(STAT_COLS)
          .order("measured_at", { ascending: false }).range(from, from + PAGE - 1);
        if (error) { console.error("[sponsored-posts] stats 조회 실패(있는 데이터로 진행):", error.message); break; }
        collect(page);
        if (!page || page.length < PAGE) break;
      }
    } else {
      // count 확보 → 전 페이지 병렬 조회(순차 왕복 제거).
      const pages = Math.max(1, Math.ceil(count / PAGE));
      const results = await Promise.all(
        Array.from({ length: pages }, (_, i) =>
          supabase.from("post_daily_stats").select(STAT_COLS)
            .order("measured_at", { ascending: false }).range(i * PAGE, i * PAGE + PAGE - 1)
        )
      );
      for (const { data: page, error } of results) {
        if (error) { console.error("[sponsored-posts] stats 조회 실패(있는 데이터로 진행):", error.message); continue; }
        collect(page);
      }
    }
  }

  const data = (posts ?? []).map((post) => ({
    ...post,
    post_daily_stats: statsByPost.get(post.id) ?? [],
  }));

  const result = (data ?? []).map((post: any) => {
    // 과거→현재 정렬
    const asc = (post.post_daily_stats ?? []).slice().sort(
      (a: { measured_at: string }, b: { measured_at: string }) =>
        new Date(a.measured_at).getTime() - new Date(b.measured_at).getTime()
    );
    // 🛡️ 누적 조회수는 감소 불가 — Apify 글리치/미완성 수집으로 낮아진 값은 직전 최대값으로 보정.
    //    (게시물 단위 증분량이 음수로 표시되는 문제 방지)
    let maxPlay = 0;
    const mono = asc.map((s: any) => {
      const playCollected = s.play_count != null; // 원본 수집 여부 (mono 보정 전)
      const play_count = playCollected ? Math.max(maxPlay, Number(s.play_count)) : maxPlay;
      maxPlay = play_count;
      return { ...s, play_count, play_collected: playCollected };
    });
    const desc = [...mono].reverse();
    // all_stats는 게시물별 이력 전량(수천 행)이라 payload의 대부분 → 프런트가 실제 쓰는 필드만 남겨 경량화.
    // (post_id·created_at은 all_stats에서 미사용. latest/prev은 created_at을 쓰므로 full mono에서 뽑음.)
    const allStatsLight = mono.map((s: any) => ({
      measured_at: s.measured_at,
      play_count: s.play_count,
      likes_count: s.likes_count,
      comments_count: s.comments_count,
      play_collected: s.play_collected,
    }));
    return {
      ...post,
      post_daily_stats: undefined,
      influencers: null,
      latest_stats: desc[0] ?? null,
      prev_stats: desc[1] ?? null,
      all_stats: allStatsLight,
    };
  });

  // 사용자별 실시간 데이터 — 엣지/브라우저 캐시 금지.
  // (기본 응답이 public이라 Vercel CDN이 옛 값을 HIT으로 내주는 문제 방지)
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  // Google Sheets Apps Script에서 인증 없이 호출 가능
  // (GET은 Clerk 인증 필요, POST는 공개 인터페이스)
  const body = await req.json();
  const supabase = getServerSupabase();

  if (Array.isArray(body)) {
    // URL 정규화 + 빈 URL 제거
    // 목적: 쿼리 파라미터, trailing slash 등을 정규화해서 중복 방지
    const rows = body
      .map(r => ({ ...r, url: r.url ? (normalizeUrl(r.url) || r.url) : r.url, ...(r.channel_type ? { channel_type: normalizeChannelType(String(r.channel_type)) } : {}) }))
      .filter(r => r.url);

    logger.info("sponsored-posts-api", "게시물 일괄 추가 시작", {
      count: body.length,
      afterNormalization: rows.length,
      filtered: body.length - rows.length,
    });

    // upsert: URL이 이미 있으면 새 컬럼값으로 업데이트, 없으면 삽입
    const { data, error } = await supabase
      .from("sponsored_posts")
      .upsert(rows, { onConflict: "url" })
      .select();

    if (error) {
      logger.error("sponsored-posts-api", "게시물 일괄 추가 실패", {
        error: error.message,
        count: rows.length,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logger.info("sponsored-posts-api", "게시물 일괄 추가 완료", {
      insertedCount: data.length,
    });

    // 캡션 빈 IG 글이 있으면 캡션 보강 즉시 트리거(이벤트 기반)
    if (rows.some(r => needsCaption(r.url, r.content_summary))) await triggerCaptionBackfill("bulk-array");

    return NextResponse.json(data, { status: 201 });
  }

  const cleaned = { ...body, url: body.url ? (normalizeUrl(body.url) || body.url) : body.url };
  if (cleaned.channel_type) cleaned.channel_type = normalizeChannelType(String(cleaned.channel_type));
  // 추가자(이메일) — created_by 컬럼이 없을 수도 있어 insert 대상에서 분리 후 삽입 성공 시 best-effort로 기록.
  const addedBy = typeof cleaned.added_by === "string" ? cleaned.added_by : null;
  delete cleaned.added_by;

  // 같은 URL 중복 추가 방지 — 정규화된 URL 기준으로 이미 있으면 409로 안내(중복 행 생성 방지).
  if (cleaned.url) {
    const { data: dup } = await supabase.from("sponsored_posts").select("id").eq("url", cleaned.url).limit(1);
    if (dup && dup.length > 0) {
      return NextResponse.json({ error: "이미 추가된 URL입니다.", duplicate: true }, { status: 409 });
    }
  }

  logger.info("sponsored-posts-api", "게시물 추가 시작", {
    url: cleaned.url,
    hasNormalization: true,
  });
  const { data, error } = await supabase
    .from("sponsored_posts")
    .insert(cleaned)
    .select()
    .single();

  if (error) {
    logger.error("sponsored-posts-api", "게시물 추가 실패", {
      error: error.message,
      url: cleaned.url,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logger.info("sponsored-posts-api", "게시물 추가 완료", {
    postId: data.id,
  });

  // 추가자 기록(best-effort). created_by 컬럼이 없으면 에러가 반환되지만 무시 — 게시물 추가 자체엔 영향 없음.
  if (addedBy && data?.id) {
    await supabase.from("sponsored_posts").update({ created_by: addedBy }).eq("id", data.id);
  }

  // 캡션 없이 추가된 IG 글이면 캡션 보강 즉시 트리거(이벤트 기반 → ~1분 내 채움)
  if (needsCaption(cleaned.url, cleaned.content_summary)) await triggerCaptionBackfill("single-add");

  return NextResponse.json(data, { status: 201 });
}
