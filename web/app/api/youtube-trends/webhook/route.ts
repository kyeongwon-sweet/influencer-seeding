import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchDatasetItems } from "@/lib/apify";

export const maxDuration = 60;

type TimelinePoint = { time?: string; value?: number[] };
type TrendItem = { searchTerm?: string; interestOverTime_timelineData?: TimelinePoint[] };

// Apify google-trends-scraper 실행 완료 시 호출됨 → 데이터셋을 youtube_search_trends 에 저장
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (!process.env.WEBHOOK_SECRET || searchParams.get("token") !== process.env.WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { resource?: { status?: string; defaultDatasetId?: string } };
  const status = body.resource?.status;
  const datasetId = body.resource?.defaultDatasetId;
  if (status !== "SUCCEEDED" || !datasetId) {
    return NextResponse.json({ ok: true, skipped: status });
  }

  const items = (await fetchDatasetItems(datasetId)) as TrendItem[];
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
  return NextResponse.json({ ok: true, saved: rows.length });
}
