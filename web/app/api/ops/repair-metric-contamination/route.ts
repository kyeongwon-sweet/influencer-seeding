import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";

type MetricField = "play_count" | "reach_count";
type RepairAction = "clear_field" | "delete_row";

const TARGETS: Array<{
  normalizedKey: string;
  exactPostId?: string;
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
    exactPostId: "91a7aada-662d-48cf-8cb1-2a567e1e3d20",
    measuredAt,
    field: "play_count" as const,
    contaminatedValues: [116853],
    action: "delete_row" as const,
  })),
  ...["2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"].map((measuredAt) => ({
    normalizedKey: "tt:7669021425163881746",
    exactPostId: "b861fcbf-79f4-4e52-b5cb-fdae01a18f6e",
    measuredAt,
    field: "play_count" as const,
    contaminatedValues: [97643],
    action: "delete_row" as const,
  })),
  { normalizedKey: "yt:GBWxY0RlRqA", exactPostId: "38efdd62-2f3b-4ff9-98ef-0c50751f0a13", measuredAt: "2026-08-26", field: "play_count", contaminatedValues: [97643], action: "delete_row" },
  ...["2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30", "2026-08-31"].map((measuredAt) => ({
    normalizedKey: "yt:GBWxY0RlRqA",
    exactPostId: "38efdd62-2f3b-4ff9-98ef-0c50751f0a13",
    measuredAt,
    field: "play_count" as const,
    contaminatedValues: [149000],
    action: "delete_row" as const,
  })),
  { normalizedKey: "tt:7677553177486478599", exactPostId: "23b92e91-d2c6-4938-b8ab-ce5df428a14b", measuredAt: "2026-08-26", field: "play_count", contaminatedValues: [466637], action: "delete_row" },
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

  const exactPostIds = [...new Set(TARGETS.map((target) => target.exactPostId).filter((id): id is string => Boolean(id)))];
  const { data: exactPosts, error: exactPostError } = exactPostIds.length
    ? await supabase.from("sponsored_posts").select("id, normalized_key").in("id", exactPostIds)
    : { data: [], error: null };
  if (exactPostError) return { rows: [], error: exactPostError.message };

  const postIdByKey = new Map([...(posts ?? []), ...(exactPosts ?? [])]
    .map((post) => [String(post.normalized_key), String(post.id)]));
  const existingPostIds = new Set([...(posts ?? []), ...(exactPosts ?? [])].map((post) => String(post.id)));
  const postIds = [...existingPostIds];
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
      const postId = target.exactPostId && existingPostIds.has(target.exactPostId)
        ? target.exactPostId
        : postIdByKey.get(target.normalizedKey) ?? null;
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
  return NextResponse.json(
    { error: "This one-time repair is permanently disabled; all historical targets are already resolved." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
