import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl } from "@/lib/url-utils";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest) {
  // URL 정규화 마이그레이션 엔드포인트
  const url = new URL(req.url);
  if (url.searchParams.has('normalize')) {
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
  const { data: posts, error: postsError } = await supabase
    .from("sponsored_posts")
    .select("*")
    .order("created_at", { ascending: false });

  if (postsError) return NextResponse.json({ error: postsError.message }, { status: 500 });

  // 모든 post_daily_stats를 한 번에 조회 후 post별 그룹핑 (N+1 쿼리 방지)
  const ids = (posts ?? []).map((p) => p.id);
  const statsByPost = new Map<string, any[]>();
  if (ids.length > 0) {
    const { data: allStats, error: statsError } = await supabase
      .from("post_daily_stats")
      .select("*")
      .in("post_id", ids)
      .order("measured_at", { ascending: false });
    if (statsError) return NextResponse.json({ error: statsError.message }, { status: 500 });
    for (const s of allStats ?? []) {
      const arr = statsByPost.get(s.post_id) ?? [];
      arr.push(s);
      statsByPost.set(s.post_id, arr);
    }
  }

  const data = (posts ?? []).map((post) => ({
    ...post,
    post_daily_stats: statsByPost.get(post.id) ?? [],
  }));

  const result = (data ?? []).map((post: any) => {
    const stats = (post.post_daily_stats ?? []).sort(
      (a: { measured_at: string }, b: { measured_at: string }) =>
        new Date(b.measured_at).getTime() - new Date(a.measured_at).getTime()
    );
    return {
      ...post,
      post_daily_stats: undefined,
      influencers: null,
      latest_stats: stats[0] ?? null,
      prev_stats: stats[1] ?? null,
      all_stats: [...stats].reverse(),
    };
  });

  return NextResponse.json(result);
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
      .map(r => ({ ...r, url: r.url ? (normalizeUrl(r.url) || r.url) : r.url }))
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

    return NextResponse.json(data, { status: 201 });
  }

  const cleaned = { ...body, url: body.url ? (normalizeUrl(body.url) || body.url) : body.url };

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

  return NextResponse.json(data, { status: 201 });
}
