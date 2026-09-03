import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";

const CONFIRMATION = "repair-2026-09-03-metric-spikes";
const NORMALIZED_KEY = "ig:Dcf5OKEiZvJ";
const DIRTY_VALUE = 116853;
const DATES = [
  "2026-08-26",
  "2026-08-27",
  "2026-08-28",
  "2026-08-29",
  "2026-08-30",
] as const;

type Inspection = {
  normalizedKey: string;
  measuredAt: string;
  postId: string | null;
  statId: string | null;
  reachCount: number | null;
  playCount: number | null;
  manual: boolean | null;
  createdAt: string | null;
  statSnapshot: Record<string, unknown> | null;
  status: "missing_post" | "ambiguous_post" | "missing_stat" | "ambiguous_stat" | "already_clean" | "repairable" | "preserved_valid";
};

async function inspectTargets(): Promise<{ rows: Inspection[]; error?: string }> {
  const supabase = getServerSupabase();
  const { data: posts, error: postError } = await supabase
    .from("sponsored_posts")
    .select("id, normalized_key")
    .eq("normalized_key", NORMALIZED_KEY);
  if (postError) return { rows: [], error: postError.message };
  if ((posts ?? []).length !== 1) {
    const status = (posts ?? []).length ? "ambiguous_post" : "missing_post";
    return {
      rows: DATES.map((measuredAt) => ({
        normalizedKey: NORMALIZED_KEY,
        measuredAt,
        postId: null,
        statId: null,
        reachCount: null,
        playCount: null,
        manual: null,
        createdAt: null,
        statSnapshot: null,
        status,
      })),
    };
  }

  const postId = String(posts![0].id);
  const { data: stats, error: statsError } = await supabase
    .from("post_daily_stats")
    .select("*")
    .eq("post_id", postId)
    .in("measured_at", [...DATES])
    .order("measured_at", { ascending: true })
    .order("id", { ascending: true });
  if (statsError) return { rows: [], error: statsError.message };

  const byDate = new Map<string, Array<Record<string, unknown>>>();
  for (const stat of stats ?? []) {
    const measuredAt = String(stat.measured_at).slice(0, 10);
    const rows = byDate.get(measuredAt) ?? [];
    rows.push(stat);
    byDate.set(measuredAt, rows);
  }

  return {
    rows: DATES.map((measuredAt): Inspection => {
      const matches = byDate.get(measuredAt) ?? [];
      const empty = {
        normalizedKey: NORMALIZED_KEY,
        measuredAt,
        postId,
        statId: null,
        reachCount: null,
        playCount: null,
        manual: null,
        createdAt: null,
        statSnapshot: null,
      };
      if (!matches.length) return { ...empty, status: "missing_stat" };
      if (matches.length !== 1) return { ...empty, status: "ambiguous_stat" };
      const stat = matches[0];
      const reachCount = stat.reach_count == null ? null : Number(stat.reach_count);
      return {
        normalizedKey: NORMALIZED_KEY,
        measuredAt,
        postId,
        statId: String(stat.id),
        reachCount,
        playCount: stat.play_count == null ? null : Number(stat.play_count),
        manual: stat.manual == null ? null : Boolean(stat.manual),
        createdAt: stat.created_at == null ? null : String(stat.created_at),
        statSnapshot: stat,
        status: reachCount == null
          ? "already_clean"
          : reachCount === DIRTY_VALUE ? "repairable" : "preserved_valid",
      };
    }),
  };
}

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const inspected = await inspectTargets();
  if (inspected.error) return NextResponse.json({ error: inspected.error }, { status: 500 });
  return NextResponse.json({ dry_run: true, rows: inspected.rows }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (body?.confirm !== CONFIRMATION) {
    return NextResponse.json({ error: "Invalid confirmation" }, { status: 400 });
  }

  const before = await inspectTargets();
  if (before.error) return NextResponse.json({ error: before.error }, { status: 500 });
  const allowed = new Set(["repairable", "already_clean"]);
  if (before.rows.length !== DATES.length || before.rows.some((row) => !allowed.has(row.status) || row.manual !== true)) {
    return NextResponse.json({ error: "Unexpected live rows or missing manual lock", before: before.rows }, { status: 409 });
  }

  const supabase = getServerSupabase();
  let updated = 0;
  for (const row of before.rows.filter((item) => item.status === "repairable")) {
    const { data, error } = await supabase
      .from("post_daily_stats")
      .update({ reach_count: null })
      .eq("id", row.statId as string)
      .eq("reach_count", DIRTY_VALUE)
      .eq("manual", true)
      .select("*");
    if (error) return NextResponse.json({ error: error.message, before: before.rows, updated }, { status: 500 });
    if ((data ?? []).length !== 1) {
      return NextResponse.json({ error: "Concurrent change detected", before: before.rows, updated }, { status: 409 });
    }
    updated++;
  }

  const after = await inspectTargets();
  if (after.error) return NextResponse.json({ error: after.error, before: before.rows, updated }, { status: 500 });
  if (after.rows.some((row) => row.status !== "already_clean" || row.reachCount !== null || row.manual !== true)) {
    return NextResponse.json({ error: "Post-repair verification failed", before: before.rows, after: after.rows, updated }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated, before: before.rows, after: after.rows });
}
