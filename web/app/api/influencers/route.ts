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
    .from("influencers")
    .select("*, screening_metrics(*)")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const supabase = getServerSupabase();

  // URL 정규화: 모든 인플루언서의 URL을 정규화 후 저장
  // 목적: URL 비교 오류 방지 (쿼리 파라미터, trailing slash 등)
  const normalizeInfluencer = (inf: any) => ({
    ...inf,
    url: inf.url ? normalizeUrl(inf.url) : inf.url,
  });

  const isArray = Array.isArray(body);
  const normalizedBody = isArray
    ? body.map(normalizeInfluencer)
    : normalizeInfluencer(body);

  logger.info("influencers-api", "인플루언서 추가 시작", {
    count: isArray ? body.length : 1,
    hasNormalization: true,
  });

  const { data, error } = isArray
    ? await supabase.from("influencers").insert(normalizedBody).select()
    : await supabase.from("influencers").insert(normalizedBody).select().single();

  if (error) {
    logger.error("influencers-api", "인플루언서 추가 실패", {
      error: error.message,
      count: isArray ? body.length : 1,
    });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  logger.info("influencers-api", "인플루언서 추가 완료", {
    insertedCount: isArray ? data.length : 1,
  });

  return NextResponse.json(data, { status: 201 });
}
