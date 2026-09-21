import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchDatasetItems } from "@/lib/apify";
import { parseGoogleTrendDataset } from "@/lib/google-trends-dataset";

export const maxDuration = 60;

// Google Trends 액터 실행 완료 시 호출됨 → 데이터셋을 google_search_trends 에 저장
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

  const items = await fetchDatasetItems(datasetId);
  const rows = parseGoogleTrendDataset(items);

  if (rows.length > 0) {
    const supabase = getServerSupabase();
    const { error } = await supabase
      .from("google_search_trends")
      .upsert(rows, { onConflict: "measured_at,keyword" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, saved: rows.length });
}
