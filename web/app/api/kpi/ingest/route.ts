import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// 진단용 GET: env 확인 + SELECT만 테스트 (INSERT hang 원인 파악)
export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: "env vars missing", supabaseUrl: !!supabaseUrl, serviceKey: !!serviceKey });
  }

  // 직접 REST API로 SELECT (SDK hang 우회)
  const res = await fetch(`${supabaseUrl}/rest/v1/kpi_snapshots?select=id&limit=1`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message }));

  const body = await (res as Response).text();
  return NextResponse.json({
    supabaseUrl: supabaseUrl.slice(0, 30) + "...",
    serviceKeyPrefix: serviceKey.slice(0, 10) + "...",
    httpStatus: (res as Response).status,
    body: body.slice(0, 300),
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
