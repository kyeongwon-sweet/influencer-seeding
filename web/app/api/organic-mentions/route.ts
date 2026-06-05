import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl } from "@/lib/url-utils";
import { logger } from "@/lib/logger";

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("organic_mentions")
    .select("*")
    .order("uploaded_at", { ascending: false, nullsFirst: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const supabase = getServerSupabase();

  // URL 정규화: 모든 무상노출 언급의 URL을 정규화 후 저장
  // 목적: URL 비교 오류 방지 (쿼리 파라미터, trailing slash 등)
  const normalizeMention = (mention: any) => ({
    ...mention,
    url: mention.url ? normalizeUrl(mention.url) : mention.url,
  });

  if (Array.isArray(body)) {
    const normalizedBody = body.map(normalizeMention);

    logger.info("organic-mentions-api", "무상노출 데이터 추가 시작", {
      count: body.length,
      hasNormalization: true,
    });

    const { data, error } = await supabase
      .from("organic_mentions")
      .insert(normalizedBody)
      .select();

    if (error) {
      logger.error("organic-mentions-api", "무상노출 데이터 추가 실패", {
        error: error.message,
        count: body.length,
      });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    logger.info("organic-mentions-api", "무상노출 데이터 추가 완료", {
      insertedCount: data.length,
    });

    return NextResponse.json(data, { status: 201 });
  }

  const normalizedBody = normalizeMention(body);

  logger.info("organic-mentions-api", "무상노출 데이터 추가 시작", {
    count: 1,
    hasNormalization: true,
  });

  const { data, error } = await supabase
    .from("organic_mentions")
    .insert(normalizedBody)
    .select()
    .single();

  if (error) {
    logger.error("organic-mentions-api", "무상노출 데이터 추가 실패", {
      error: error.message,
      count: 1,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logger.info("organic-mentions-api", "무상노출 데이터 추가 완료", {
    insertedCount: 1,
  });

  return NextResponse.json(data, { status: 201 });
}
