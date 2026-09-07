import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import {
  EXPORT_STATS_HEARTBEAT_SERVICE,
  isIsoDate,
  parseExportStatsHeartbeatInput,
} from "@/lib/automation-heartbeat";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") return unauthorized();

  let input;
  try {
    input = parseExportStatsHeartbeatInput(await req.json());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  const lastSuccessAt = new Date().toISOString();
  const payload = { ...input, last_success_at: lastSuccessAt };
  const { data, error } = await getServerSupabase()
    .from("ops_daily_runs")
    .upsert({
      service: EXPORT_STATS_HEARTBEAT_SERVICE,
      run_date: input.written_date,
      status: "done",
      payload,
    }, { onConflict: "service,run_date" })
    .select("service, run_date, status, payload, updated_at")
    .single();

  if (error) {
    console.error("[automation-heartbeat] exportStats mark failed", error.message);
    return NextResponse.json({ error: "heartbeat write failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, marker: data });
}

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") return unauthorized();
  const writtenDate = req.nextUrl.searchParams.get("written_date") || "";
  if (writtenDate && !isIsoDate(writtenDate)) {
    return NextResponse.json({ error: "written_date must be YYYY-MM-DD" }, { status: 400 });
  }

  const base = getServerSupabase()
    .from("ops_daily_runs")
    .select("service, run_date, status, payload, created_at, updated_at")
    .eq("service", EXPORT_STATS_HEARTBEAT_SERVICE)
    .eq("status", "done");
  const { data, error } = writtenDate
    ? await base.eq("run_date", writtenDate).limit(1).maybeSingle()
    : await base.order("run_date", { ascending: false }).order("updated_at", { ascending: false }).limit(1).maybeSingle();

  if (error) {
    console.error("[automation-heartbeat] exportStats read failed", error.message);
    return NextResponse.json({ error: "heartbeat read failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, marker: data ?? null });
}
