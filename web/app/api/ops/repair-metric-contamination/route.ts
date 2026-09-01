import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";

type MetricField = "play_count" | "reach_count";
type RepairAction = "clear_field" | "delete_row";

const CONFIRMATION = "repair-2026-08-27-metric-contamination";
const TARGETS: Array<{
  normalizedKey: string;
  measuredAt: string;
  field: MetricField;
  contaminatedValues: number[];
  action?: RepairAction;
}> = [
  { normalizedKey: "ig:Db5iVQYhJT5", measuredAt: "2026-08-26", field: "play_count", contaminatedValues: [466637] },
  { normalizedKey: "ig:Db5fNo6k6bI", measuredAt: "2026-08-26", field: "reach_count", contaminatedValues: [466637] },
  { normalizedKey: "ig:Db5fNo6k6bI", measuredAt: "2026-08-27", field: "reach_count", contaminatedValues: [633000, 633374] },
  { normalizedKey: "ig:Db5fNo6k6bI", measuredAt: "2026-08-28", field: "reach_count", contaminatedValues: [633000, 633374] },
  { normalizedKey: "ig:Db5fNo6k6bI", measuredAt: "2026-08-29", field: "reach_count", contaminatedValues: [633000, 633374] },
  { normalizedKey: "ig:Db5fNo6k6bI", measuredAt: "2026-08-30", field: "reach_count", contaminatedValues: [633000, 633374] },
  { normalizedKey: "tt:7677553177486478599", measuredAt: "2026-08-26", field: "play_count", contaminatedValues: [466637] },
  { normalizedKey: "tt:7677553177486478599", measuredAt: "2026-08-27", field: "play_count", contaminatedValues: [633000, 633374] },
  ...["2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"].map((measuredAt) => ({
    normalizedKey: "tt:7677969398061141255",
    measuredAt,
    field: "play_count" as const,
    contaminatedValues: [116853],
    action: "delete_row" as const,
  })),
  ...["2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"].map((measuredAt) => ({
    normalizedKey: "tt:7669021425163881746",
    measuredAt,
    field: "play_count" as const,
    contaminatedValues: [97643],
    action: "delete_row" as const,
  })),
  { normalizedKey: "yt:GBWxY0RlRqA", measuredAt: "2026-08-26", field: "play_count", contaminatedValues: [97643], action: "delete_row" },
  ...["2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"].map((measuredAt) => ({
    normalizedKey: "yt:GBWxY0RlRqA",
    measuredAt,
    field: "play_count" as const,
    contaminatedValues: [149000],
    action: "delete_row" as const,
  })),
  { normalizedKey: "tt:7677553177486478599", measuredAt: "2026-08-26", field: "play_count", contaminatedValues: [466637], action: "delete_row" },
];

type InspectedTarget = (typeof TARGETS)[number] & {
  postId: string | null;
  statId: string | null;
  value: number | null;
  manual: boolean | null;
  createdAt: string | null;
  action: RepairAction;
  statSnapshot: Record<string, unknown> | null;
  status: "missing_post" | "missing_stat" | "ambiguous_stat" | "already_clean" | "repairable" | "preserved_valid";
};

async function inspectTargets(): Promise<{ rows: InspectedTarget[]; error?: string }> {
  const supabase = getServerSupabase();
  const keys = [...new Set(TARGETS.map((target) => target.normalizedKey))];
  const { data: posts, error: postError } = await supabase
    .from("sponsored_posts")
    .select("id, normalized_key")
    .in("normalized_key", keys);
  if (postError) return { rows: [], error: postError.message };

  const postIdByKey = new Map((posts ?? []).map((post) => [String(post.normalized_key), String(post.id)]));
  const postIds = [...postIdByKey.values()];
  const dates = [...new Set(TARGETS.map((target) => target.measuredAt))];
  const { data: stats, error: statsError } = postIds.length
    ? await supabase
      .from("post_daily_stats")
      .select("*")
      .in("post_id", postIds)
      .in("measured_at", dates)
    : { data: [], error: null };
  if (statsError) return { rows: [], error: statsError.message };

  const statsByPostDate = new Map<string, Array<Record<string, unknown>>>();
  for (const stat of stats ?? []) {
    const key = `${stat.post_id}|${String(stat.measured_at).slice(0, 10)}`;
    const rows = statsByPostDate.get(key) ?? [];
    rows.push(stat);
    statsByPostDate.set(key, rows);
  }
  return {
    rows: TARGETS.map((target): InspectedTarget => {
      const action = target.action ?? "clear_field";
      const postId = postIdByKey.get(target.normalizedKey) ?? null;
      const empty = { ...target, action, postId, statId: null, value: null, manual: null, createdAt: null, statSnapshot: null };
      if (!postId) return { ...empty, status: "missing_post" };
      const matchingStats = statsByPostDate.get(`${postId}|${target.measuredAt}`) ?? [];
      if (!matchingStats.length) return { ...empty, status: "missing_stat" };
      if (matchingStats.length !== 1) return { ...empty, status: "ambiguous_stat" };
      const stat = matchingStats[0];
      const raw = stat[target.field];
      const value = raw == null ? null : Number(raw);
      const status = value == null
        ? "already_clean"
        : target.contaminatedValues.includes(value)
          ? "repairable"
          : "preserved_valid";
      return {
        ...target,
        postId,
        statId: String(stat.id),
        value,
        manual: stat.manual == null ? null : Boolean(stat.manual),
        createdAt: stat.created_at == null ? null : String(stat.created_at),
        action,
        statSnapshot: stat,
        status,
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
  if (before.rows.some((row) => row.status === "ambiguous_stat")) {
    return NextResponse.json({ error: "Ambiguous daily-stat rows", before: before.rows }, { status: 409 });
  }
  const supabase = getServerSupabase();
  let updated = 0;
  let deleted = 0;
  const deletedRows: Array<Record<string, unknown>> = [];
  for (const row of before.rows.filter((item) => item.status === "repairable")) {
    const query = supabase
      .from("post_daily_stats");
    const { data, error } = row.action === "delete_row"
      ? await query.delete().eq("id", row.statId as string).eq(row.field, row.value as number).select("*")
      : await query.update({ [row.field]: null }).eq("id", row.statId as string).eq(row.field, row.value as number).select("*");
    if (error) return NextResponse.json({ error: error.message, before: before.rows, updated, deleted }, { status: 500 });
    if ((data ?? []).length !== 1) {
      return NextResponse.json({ error: "Concurrent change detected", before: before.rows, updated, deleted }, { status: 409 });
    }
    if (row.action === "delete_row") {
      deleted++;
      deletedRows.push((data ?? [])[0] as Record<string, unknown>);
    } else {
      updated++;
    }
  }

  const after = await inspectTargets();
  if (after.error) return NextResponse.json({ error: after.error, before: before.rows, updated, deleted }, { status: 500 });
  if (after.rows.some((row) => row.status === "repairable")) {
    return NextResponse.json({ error: "Post-repair verification failed", before: before.rows, after: after.rows, updated, deleted }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated, deleted, deletedRows, before: before.rows, after: after.rows });
}
