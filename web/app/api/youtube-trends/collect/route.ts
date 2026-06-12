import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const maxDuration = 300; // Apify 액터 동기 실행 여유

// 유튜브 검색 트렌드를 볼 키워드 (Google Trends gprop=youtube, 상대값 0~100)
const KEYWORDS = ["라라스윗", "라라스윗아이스크림"];

type TimelinePoint = { time?: string; value?: number[] };
type TrendItem = { searchTerm?: string; interestOverTime_timelineData?: TimelinePoint[] };

export async function POST(req: NextRequest) {
  // Vercel Cron 호출 — CRON_SECRET 자동 주입
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = process.env.APIFY_API_TOKEN;
  if (!token) return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });

  // 키워드별 Google Trends URL(gprop=youtube) 한 번에 실행
  const startUrls = KEYWORDS.map((kw) => ({
    url: `https://trends.google.com/trends/explore?date=today%203-m&geo=KR&gprop=youtube&q=${encodeURIComponent(kw)}`,
  }));

  const runRes = await fetch(
    `https://api.apify.com/v2/acts/apify~google-trends-scraper/run-sync-get-dataset-items?token=${token}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startUrls, maxItems: 50 }),
    }
  );
  if (!runRes.ok) {
    return NextResponse.json({ error: `Apify 실행 실패: ${runRes.status}` }, { status: 502 });
  }
  const items = (await runRes.json()) as TrendItem[];

  // 상대값(0~100)은 조회 윈도우마다 재정규화되므로, 매 수집 시 해당 날짜를 덮어씀(upsert)
  const rows: { measured_at: string; keyword: string; value: number | null }[] = [];
  for (const it of items) {
    const kw = it.searchTerm;
    if (!kw) continue;
    for (const p of it.interestOverTime_timelineData ?? []) {
      const ts = Number(p.time);
      if (!ts) continue;
      const date = new Date(ts * 1000).toISOString().slice(0, 10);
      const v = Array.isArray(p.value) ? p.value[0] : null;
      rows.push({ measured_at: date, keyword: kw, value: v ?? null });
    }
  }

  if (rows.length > 0) {
    const supabase = getServerSupabase();
    const { error } = await supabase
      .from("youtube_search_trends")
      .upsert(rows, { onConflict: "measured_at,keyword" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, keywords: items.map((i) => i.searchTerm), saved: rows.length });
}
