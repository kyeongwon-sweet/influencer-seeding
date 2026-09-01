import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";

type MetricField = "play_count" | "reach_count";

const CONFIRMATION = "repair-2026-08-27-metric-contamination";
const TARGETS: Array<{
  normalizedKey: string;
  measuredAt: string;
  field: MetricField;
  contaminatedValues: number[];
}> = [
  { normalizedKey: "ig:Db5iVQYhJT5", measuredAt: "2026-08-26", field: "play_count", contaminatedValues: [466637] },
  { normalizedKey: "ig:Db5fNo6k6bI", measuredAt: "2026-08-26", field: "reach_count", contaminatedValues: [466637] },
  { normalizedKey: "ig:Db5fNo6k6bI", measuredAt: "2026-08-27", field: "reach_count", contaminatedValues: [633000, 633374] },
  { normalizedKey: "tt:7677553177486478599", measuredAt: "2026-08-26", field: "play_count", contaminatedValues: [466637] },
  { normalizedKey: "tt:7677553177486478599", measuredAt: "2026-08-27", field: "play_count", contaminatedValues: [633000, 633374] },
];

type InspectedTarget = (typeof TARGETS)[number] & {
  postId: string | null;
  statId: string | null;
  value: number | null;
  manual: boolean | null;
  createdAt: string | null;
  status: "missing_post" | "missing_stat" | "already_clean" | "repairable" | "preserved_valid";
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
      .select("id, post_id, measured_at, play_count, reach_count, manual, created_at")
      .in("post_id", postIds)
      .in("measured_at", dates)
    : { data: [], error: null };
  if (statsError) return { rows: [], error: statsError.message };

  const statByPostDate = new Map(
    (stats ?? []).map((stat) => [`${stat.post_id}|${String(stat.measured_at).slice(0, 10)}`, stat]),
  );
  return {
    rows: TARGETS.map((target): InspectedTarget => {
      const postId = postIdByKey.get(target.normalizedKey) ?? null;
      if (!postId) return { ...target, postId, statId: null, value: null, manual: null, createdAt: null, status: "missing_post" };
      const stat = statByPostDate.get(`${postId}|${target.measuredAt}`);
      if (!stat) return { ...target, postId, statId: null, value: null, manual: null, createdAt: null, status: "missing_stat" };
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
  const supabase = getServerSupabase();
  let updated = 0;
  for (const row of before.rows.filter((item) => item.status === "repairable")) {
    const { data, error } = await supabase
      .from("post_daily_stats")
      .update({ [row.field]: null })
      .eq("id", row.statId as string)
      .eq(row.field, row.value as number)
      .select("id");
    if (error) return NextResponse.json({ error: error.message, before: before.rows, updated }, { status: 500 });
    if ((data ?? []).length !== 1) {
      return NextResponse.json({ error: "Concurrent change detected", before: before.rows, updated }, { status: 409 });
    }
    updated++;
  }

  const after = await inspectTargets();
  if (after.error) return NextResponse.json({ error: after.error, before: before.rows, updated }, { status: 500 });
  if (after.rows.some((row) => row.status === "repairable")) {
    return NextResponse.json({ error: "Post-repair verification failed", before: before.rows, after: after.rows, updated }, { status: 500 });
  }
  return NextResponse.json({ ok: true, updated, before: before.rows, after: after.rows });
}
