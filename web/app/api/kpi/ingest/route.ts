import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function POST(req: NextRequest) {
  // Apps Script에서 보낸 Authorization: Bearer <CRON_SECRET> 검증
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  // secret이 없으면 잘못된 서버 설정 → 무조건 차단
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.metrics || !Array.isArray(body.metrics)) {
    return NextResponse.json({ error: "metrics 배열이 없습니다" }, { status: 400 });
  }

  const supabase = getServerSupabase();
  const { error } = await supabase.from("kpi_snapshots").insert({
    month_label: body.month_label ?? null,
    metrics: body.metrics,
    fetched_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  return NextResponse.json({ ok: true });
}
