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

const JOB_TYPE = "monitoring";

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
  const payload = {
    ops_marker: EXPORT_STATS_HEARTBEAT_SERVICE,
    run_date: input.written_date,
    ...input,
    last_success_at: lastSuccessAt,
  };
  const supabase = getServerSupabase();
  const existing = await supabase
    .from("jobs")
    .select("id")
    .eq("type", JOB_TYPE)
    .eq("status", "done")
    .contains("payload", {
      ops_marker: EXPORT_STATS_HEARTBEAT_SERVICE,
      run_date: input.written_date,
    })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    console.error("[automation-heartbeat] exportStats lookup failed", existing.error.message);
    return NextResponse.json({ error: "heartbeat lookup failed" }, { status: 500 });
  }

  const mutation = existing.data?.id
    ? supabase
      .from("jobs")
      .update({ payload, error: null })
      .eq("id", existing.data.id)
    : supabase
      .from("jobs")
      .insert({ type: JOB_TYPE, status: "done", payload });
  const { data, error } = await mutation
    .select("id, status, payload, created_at, updated_at")
    .single();

  if (error) {
    console.error("[automation-heartbeat] exportStats mark failed", error.message);
    return NextResponse.json({ error: "heartbeat write failed" }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    marker: {
      service: EXPORT_STATS_HEARTBEAT_SERVICE,
      run_date: input.written_date,
      ...data,
    },
  });
}

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") return unauthorized();
  const writtenDate = req.nextUrl.searchParams.get("written_date") || "";
  if (writtenDate && !isIsoDate(writtenDate)) {
    return NextResponse.json({ error: "written_date must be YYYY-MM-DD" }, { status: 400 });
  }

  const base = getServerSupabase()
    .from("jobs")
    .select("id, status, payload, created_at, updated_at")
    .eq("type", JOB_TYPE)
    .eq("status", "done");
  const { data, error } = writtenDate
    ? await base
      .contains("payload", {
        ops_marker: EXPORT_STATS_HEARTBEAT_SERVICE,
        run_date: writtenDate,
      })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    : await base
      .contains("payload", { ops_marker: EXPORT_STATS_HEARTBEAT_SERVICE })
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  if (error) {
    console.error("[automation-heartbeat] exportStats read failed", error.message);
    return NextResponse.json({ error: "heartbeat read failed" }, { status: 500 });
  }
  const payload = data?.payload as Record<string, unknown> | null | undefined;
  return NextResponse.json({
    ok: true,
    marker: data
      ? {
        service: EXPORT_STATS_HEARTBEAT_SERVICE,
        run_date: payload?.run_date ?? null,
        ...data,
      }
      : null,
  });
}
