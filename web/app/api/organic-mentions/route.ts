import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { logger } from "@/lib/logger";
import { splitDuplicateMentions, type Mentionish } from "@/lib/url-utils";

type OrganicMentionPayload = Mentionish;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("organic_mentions")
    .select("*")
    .order("uploaded_at", { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // 편집 가능한 공유 목록이라 5분 캐시는 수정 반영이 늦음 → 30초로 단축(비용은 거의 그대로, 최신성↑).
  return NextResponse.json(data, { headers: { "Cache-Control": "s-maxage=30, stale-while-revalidate=60" } });
}

/** 저장된 URL 전량(중복 판정용). 목록이 크지 않아 한 번에 읽되 페이지네이션은 지킨다. */
async function loadExistingUrls(supabase: ReturnType<typeof getServerSupabase>): Promise<string[]> {
  const urls: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("organic_mentions")
      .select("url")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<{ url: string | null }>) {
      if (row.url) urls.push(row.url);
    }
    if (!data || data.length < PAGE) break;
  }
  return urls;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const supabase = getServerSupabase();

  // URL 정규화 + 중복 차단.
  //  - 정규화(normalizeUrl)가 쿼리스트링을 버리므로 utm_source·igsh·fbclid 등이 붙어도 같은 글로 접힌다.
  //  - 이미 저장된 URL, 그리고 같은 요청 안에서 겹치는 URL 모두 저장하지 않는다.
  let existingUrls: string[];
  try {
    existingUrls = await loadExistingUrls(supabase);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("organic-mentions-api", "기존 URL 조회 실패", { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const items: OrganicMentionPayload[] = Array.isArray(body) ? (body as OrganicMentionPayload[]) : [body as OrganicMentionPayload];
  const { unique, duplicates, invalid } = splitDuplicateMentions(items, existingUrls);

  // 단건 추가에서 중복이면 409로 분명히 알린다(화면이 사유를 그대로 보여준다).
  if (!Array.isArray(body)) {
    if (invalid.length > 0) {
      return NextResponse.json({ error: "링크(URL)를 입력해주세요." }, { status: 400 });
    }
    if (duplicates.length > 0) {
      const url = duplicates[0].url;
      logger.info("organic-mentions-api", "중복 링크 차단", { url });
      return NextResponse.json(
        { error: `이미 등록된 링크입니다. (${url})`, duplicate: true, url },
        { status: 409 },
      );
    }
  }

  logger.info("organic-mentions-api", "무상노출 데이터 추가 시작", {
    count: items.length,
    unique: unique.length,
    duplicates: duplicates.length,
    invalid: invalid.length,
  });

  if (unique.length === 0) {
    // 배열 요청인데 전부 중복/무효 — 실패가 아니라 '추가 0건'으로 알린다.
    return NextResponse.json(
      { inserted: 0, skipped: duplicates.length, invalid: invalid.length, skippedUrls: duplicates.map((d) => d.url), data: [] },
      { status: 200 },
    );
  }

  const { data, error } = await supabase.from("organic_mentions").insert(unique).select();

  if (error) {
    logger.error("organic-mentions-api", "무상노출 데이터 추가 실패", { error: error.message, count: unique.length });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logger.info("organic-mentions-api", "무상노출 데이터 추가 완료", {
    insertedCount: data.length,
    skipped: duplicates.length,
  });

  if (!Array.isArray(body)) return NextResponse.json(data[0], { status: 201 });

  return NextResponse.json(
    { inserted: data.length, skipped: duplicates.length, invalid: invalid.length, skippedUrls: duplicates.map((d) => d.url), data },
    { status: 201 },
  );
}

