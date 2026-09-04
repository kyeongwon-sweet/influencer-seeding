import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";

const NORMALIZED_KEY = "ig:Dcf5OKEiZvJ";
const DIRTY_VALUE = 116853;
const SECOND_DIRTY_VALUE = 198660;
const VERIFIED_DATE = "2026-09-02";
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
      const playCount = stat.play_count == null ? null : Number(stat.play_count);
      const metricValues = [reachCount, playCount];
      const alreadyClean = metricValues.every((value) => value == null);
      const onlyApprovedDirtyValue = metricValues.every((value) => value == null || value === DIRTY_VALUE);
      return {
        normalizedKey: NORMALIZED_KEY,
        measuredAt,
        postId,
        statId: String(stat.id),
        reachCount,
        playCount,
        manual: stat.manual == null ? null : Boolean(stat.manual),
        createdAt: stat.created_at == null ? null : String(stat.created_at),
        statSnapshot: stat,
        status: alreadyClean
          ? "already_clean"
          : onlyApprovedDirtyValue ? "repairable" : "preserved_valid",
      };
    }),
  };
}

async function inspectFinalVerification(postId: string | null) {
  const supabase = getServerSupabase();
  const [dirty116853, dirty198660, verifiedDate] = await Promise.all([
    supabase
      .from("post_daily_stats")
      .select("id", { count: "exact", head: true })
      .eq("reach_count", DIRTY_VALUE),
    supabase
      .from("post_daily_stats")
      .select("id", { count: "exact", head: true })
      .eq("reach_count", SECOND_DIRTY_VALUE),
    postId
      ? supabase
          .from("post_daily_stats")
          .select("id, post_id, measured_at, play_count, reach_count, manual, created_at")
          .eq("post_id", postId)
          .eq("measured_at", VERIFIED_DATE)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const error = dirty116853.error ?? dirty198660.error ?? verifiedDate.error;
  if (error) return { error: error.message };
  return {
    globalReachCounts: {
      [DIRTY_VALUE]: dirty116853.count ?? 0,
      [SECOND_DIRTY_VALUE]: dirty198660.count ?? 0,
    },
    verifiedDate: VERIFIED_DATE,
    verifiedDateRows: verifiedDate.data ?? [],
  };
}

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const inspected = await inspectTargets();
  if (inspected.error) return NextResponse.json({ error: inspected.error }, { status: 500 });
  const verification = await inspectFinalVerification(inspected.rows[0]?.postId ?? null);
  if (verification.error) return NextResponse.json({ error: verification.error }, { status: 500 });
  return NextResponse.json(
    { dry_run: true, rows: inspected.rows, verification },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    { error: "This one-time repair is permanently disabled; its original contamination verdict was reversed." },
    { status: 410, headers: { "Cache-Control": "no-store" } },
  );
}
