import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// 진단용 GET: Supabase 연결 + 테스트 삽입 확인
export async function GET() {
  const supabase = getServerSupabase();
  const { data, error } = await supabase.from("kpi_snapshots").insert({
    month_label: "진단테스트",
    metrics: [{ label: "test", target: 1, current: 1, achievement: 100 }],
  }).select();
  return NextResponse.json({
    supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    insertError: error?.message ?? null,
    inserted: data,
  });
}

export async function POST(req: NextRequest) {
  // Apps Script에서 보낸 Authorization: Bearer <CRON_SECRET> 검증
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
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
  });

  if (error) return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  return NextResponse.json({ ok: true });
}
