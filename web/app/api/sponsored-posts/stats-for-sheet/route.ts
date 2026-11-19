import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isBannerChannel } from "@/app/monitoring/lib";
import { checkCronAuth } from "@/lib/cron-auth";
import { todayKST } from "@/lib/dateRule";
import {
  compareStatsForSheetPayloads,
  parseStatsForSheetPayload,
  statsForSheetMode,
  statsForSheetOptimizedGateReady,
  STATS_FOR_SHEET_RPC_CONTRACT_VERSION,
  STATS_FOR_SHEET_SHADOW_AUDIT_VERSION,
  STATS_FOR_SHEET_SHADOW_SERVICE,
  type StatsForSheetComparison,
  type StatsForSheetPayload,
} from "@/lib/stats-for-sheet-bundle";
import { getServerSupabase } from "@/lib/supabase-server";
import { postIdentityKey } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// shadow = legacy pagination (~130s) + optimized RPC (hard-capped below).
export const maxDuration = 300;

const PAGE = 1000;
const OPTIMIZED_RPC_TIMEOUT_MS = 45_000;
const SHADOW_JOB_TYPE = "monitoring";

type ServerSupabase = ReturnType<typeof getServerSupabase>;
type StatsForSheetLoad = {
  payload: StatsForSheetPayload;
  sourcePosts: number;
  sourceStats: number;
};
type ShadowOutcome = "legacy" | "shadow_match" | "shadow_mismatch" | "shadow_inconclusive"
  | "optimized" | "fallback_gate" | "fallback_rpc";

// 시트 Apps Script가 '자동수집 조회수 → 시트 I열~ 역채움'을 위해 호출하는 라우트.
// URL별 (날짜, 조회수) 목록을 반환. 인증: Authorization: Bearer <CRON_SECRET> (list-for-sheet 등과 동일).
// 반환: { posts: [ { url, key, ended_at, stats: [ [measured_at, metric, manual, zero_confirmed], ... ] } ] }
// 배너 metric = reach_count, 그 외 metric = play_count.
// manual=false인 자동 수집값만 Apps Script가 기존 날짜 셀을 DB 정본으로 갱신한다.
// manual=true인 사람 입력값은 빈칸 보강에만 쓰고, 이미 있는 시트 수기값은 보존한다.
async function loadLegacyStatsForSheet(supabase: ServerSupabase): Promise<StatsForSheetLoad> {
  // 1) post_id → canonical key
  //    IG는 /p/·/reel/·/tv/가 같은 shortcode라 normalizeUrl 기준으로 묶는다.
  const keyById = new Map<string, string>();
  const urlByKey = new Map<string, string>();
  const postedAtById = new Map<string, string>();
  const endedByKey = new Map<string, string>();
  const activeKey = new Set<string>();
  const bannerById = new Map<string, boolean>();
  const youtubeById = new Map<string, boolean>();
  let sourcePosts = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("sponsored_posts")
      .select("id, url, posted_at, channel_type, ended_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`legacy sponsored_posts: ${error.message}`);
    sourcePosts += (data ?? []).length;
    for (const p of data ?? []) {
      if (p.url) {
        const rawUrl = String(p.url);
        const key = postIdentityKey(rawUrl) ?? rawUrl.trim();
        keyById.set(p.id as string, key);
        if (!urlByKey.has(key)) urlByKey.set(key, rawUrl);
        if (p.ended_at) {
          const endedAt = String(p.ended_at).slice(0, 10);
          const prev = endedByKey.get(key);
          if (!prev || endedAt > prev) endedByKey.set(key, endedAt);
        } else {
          activeKey.add(key);
        }
      }
      if (p.posted_at) postedAtById.set(p.id as string, String(p.posted_at).slice(0, 10));
      bannerById.set(p.id as string, isBannerChannel(p.channel_type, p.posted_at));
      youtubeById.set(p.id as string, /(?:youtube\.com|youtu\.be)/i.test(String(p.url ?? "")));
    }
    if (!data || data.length < PAGE) break;
  }

  // 2) 일자별 지표 → canonical key별 그룹
  const byKey = new Map<string, Map<string, { value: number; manual: boolean; zeroConfirmed: boolean }>>();
  let prePostedDropped = 0;
  let sourceStats = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("post_daily_stats")
      .select("id, post_id, measured_at, play_count, reach_count, manual, created_at")
      .order("post_id", { ascending: true })
      .order("measured_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`legacy post_daily_stats: ${error.message}`);
    sourceStats += (data ?? []).length;
    for (const s of data ?? []) {
      const key = keyById.get(s.post_id as string);
      if (!key) continue;
      const measuredAt = String(s.measured_at).slice(0, 10);
      const postedAt = postedAtById.get(s.post_id as string);
      if (postedAt && measuredAt < postedAt) {
        prePostedDropped++;
        continue;
      }
      // 배너는 모두 도달수가 정본이다. 출처(manual)를 함께 내려 보내므로, 사람이 넣은 reach는
      // 기존 시트 셀을 덮지 않고 빈칸만 보강할 수 있다. 반대로 자동 수집값은 기존 오염 셀도 교정한다.
      const metric = bannerById.get(s.post_id as string) ? s.reach_count : s.play_count;
      if (metric == null || !Number.isFinite(Number(metric)) || Number(metric) < 0) continue;
      // 0은 일반적으로 액터 결측의 대리값일 수 있어 계속 차단한다. 다만 YouTube는 공식 Data API
      // 검증 경로가 배포된 시점 이후 자동 0과 사람이 직접 확인한 manual 0만 실측으로 인정한다.
      // 이 마커 없이는 Apps Script가 0을 공란으로 버려 DB와 연동시트가 영구 불일치했다.
      const zeroConfirmed = Number(metric) === 0
        && youtubeById.get(s.post_id as string) === true
        && (Boolean(s.manual) || String(s.created_at ?? "") >= "2026-10-12T00:55:00");
      if (Number(metric) === 0 && !zeroConfirmed) continue;
      const byDate = byKey.get(key) ?? new Map<string, { value: number; manual: boolean; zeroConfirmed: boolean }>();
      const prev = byDate.get(measuredAt);
      const candidate = { value: Number(metric), manual: Boolean(s.manual), zeroConfirmed };
      if (prev == null || candidate.value > prev.value) {
        // 같은 canonical key/date에 중복 게시물 행이 있으면 어느 쪽이 정본인지 불명확하다.
        // 하나라도 수기면 보수적으로 manual=true로 내려 기존 시트값을 덮지 않는다.
        byDate.set(measuredAt, {
          ...candidate,
          manual: candidate.manual || Boolean(prev?.manual),
          zeroConfirmed: candidate.zeroConfirmed || Boolean(prev?.zeroConfirmed),
        });
      } else if ((candidate.manual && !prev.manual) || (candidate.zeroConfirmed && !prev.zeroConfirmed)) {
        byDate.set(measuredAt, {
          ...prev,
          manual: prev.manual || candidate.manual,
          zeroConfirmed: prev.zeroConfirmed || candidate.zeroConfirmed,
        });
      }
      byKey.set(key, byDate);
    }
    if (!data || data.length < PAGE) break;
  }

  const posts = [...byKey.entries()].map(([key, byDate]) => ({
    url: urlByKey.get(key) ?? key,
    key,
    ended_at: activeKey.has(key) ? null : endedByKey.get(key) ?? null,
    stats: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, stat]) => [date, stat.value, stat.manual, stat.zeroConfirmed] as const),
  }));
  let endedWithoutStats = 0;
  for (const [key, endedAt] of endedByKey.entries()) {
    if (activeKey.has(key) || byKey.has(key)) continue;
    endedWithoutStats++;
    posts.push({
      url: urlByKey.get(key) ?? key,
      key,
      ended_at: endedAt,
      stats: [],
    });
  }
  return {
    payload: { posts, pre_posted_dropped: prePostedDropped, ended_without_stats: endedWithoutStats },
    sourcePosts,
    sourceStats,
  };
}

async function loadOptimizedStatsForSheet(supabase: ServerSupabase): Promise<StatsForSheetLoad> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPTIMIZED_RPC_TIMEOUT_MS);
  try {
    const { data, error } = await supabase
      .rpc("stats_for_sheet_bundle_v1")
      .abortSignal(controller.signal);
    if (error) throw new Error(`optimized RPC: ${error.message}`);
    const row = Array.isArray(data)
      ? data[0] as {
        bundle?: unknown;
        source_posts?: unknown;
        source_stats?: unknown;
        contract_version?: unknown;
      } | undefined
      : undefined;
    if (!row || !("bundle" in row)) throw new Error("optimized RPC returned no bundle row");
    if (row.contract_version !== STATS_FOR_SHEET_RPC_CONTRACT_VERSION) {
      throw new Error("optimized RPC contract version mismatch");
    }
    const sourcePosts = Number(row.source_posts);
    const sourceStats = Number(row.source_stats);
    if (!Number.isSafeInteger(sourcePosts) || sourcePosts < 0
        || !Number.isSafeInteger(sourceStats) || sourceStats < 0) {
      throw new Error("optimized RPC returned invalid source counts");
    }
    return { payload: parseStatsForSheetPayload(row.bundle), sourcePosts, sourceStats };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("optimized RPC timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readStatsForSheetWatermark(supabase: ServerSupabase): Promise<string | null> {
  const { data, error } = await supabase.rpc("stats_for_sheet_watermark_v1");
  if (error) return null;
  const row = Array.isArray(data) ? data[0] as { watermark?: unknown } | undefined : undefined;
  return typeof row?.watermark === "string" && row.watermark ? row.watermark : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function recordShadowAudit(
  supabase: ServerSupabase,
  input: {
    comparison?: StatsForSheetComparison;
    stableSnapshot: boolean;
    optimizedError?: boolean;
    sourceCountsEqual?: boolean;
    legacySourcePosts?: number;
    optimizedSourcePosts?: number;
    legacySourceStats?: number;
    optimizedSourceStats?: number;
    legacyMs: number;
    optimizedMs: number;
  },
): Promise<void> {
  const equal = input.stableSnapshot && input.comparison?.equal === true
    && input.sourceCountsEqual === true && !input.optimizedError;
  const runDate = todayKST();
  const payload = {
    ops_marker: STATS_FOR_SHEET_SHADOW_SERVICE,
    run_date: runDate,
    version: STATS_FOR_SHEET_SHADOW_AUDIT_VERSION,
    equal,
    stable_snapshot: input.stableSnapshot,
    optimized_error: Boolean(input.optimizedError),
    legacy_hash: input.comparison ? sha256(input.comparison.legacyCanonical) : null,
    optimized_hash: input.comparison ? sha256(input.comparison.optimizedCanonical) : null,
    legacy_posts: input.comparison?.legacyPosts ?? null,
    optimized_posts: input.comparison?.optimizedPosts ?? null,
    legacy_stats: input.comparison?.legacyStats ?? null,
    optimized_stats: input.comparison?.optimizedStats ?? null,
    source_counts_equal: input.sourceCountsEqual ?? false,
    legacy_source_posts: input.legacySourcePosts ?? null,
    optimized_source_posts: input.optimizedSourcePosts ?? null,
    legacy_source_stats: input.legacySourceStats ?? null,
    optimized_source_stats: input.optimizedSourceStats ?? null,
    legacy_ms: input.legacyMs,
    optimized_ms: input.optimizedMs,
  };
  const existing = await supabase
    .from("jobs")
    .select("id")
    .eq("type", SHADOW_JOB_TYPE)
    .eq("status", "done")
    .contains("payload", { ops_marker: STATS_FOR_SHEET_SHADOW_SERVICE, run_date: runDate })
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    console.error("[stats-for-sheet] shadow audit lookup failed", existing.error.message);
    return;
  }
  const mutation = existing.data?.id
    ? supabase.from("jobs").update({ payload, error: null }).eq("id", existing.data.id)
    : supabase.from("jobs").insert({ type: SHADOW_JOB_TYPE, status: "done", payload });
  const { error } = await mutation;
  if (error) console.error("[stats-for-sheet] shadow audit write failed", error.message);
}

async function optimizedGateReady(supabase: ServerSupabase): Promise<boolean> {
  const { data, error } = await supabase
    .from("jobs")
    .select("status, payload, updated_at")
    .eq("type", SHADOW_JOB_TYPE)
    .eq("status", "done")
    .contains("payload", { ops_marker: STATS_FOR_SHEET_SHADOW_SERVICE })
    .order("updated_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("[stats-for-sheet] optimized gate read failed", error.message);
    return false;
  }
  return statsForSheetOptimizedGateReady(data ?? []);
}

function response(payload: StatsForSheetPayload, mode: string, outcome: ShadowOutcome): NextResponse {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "X-Stats-For-Sheet-Mode": mode,
      "X-Stats-For-Sheet-Outcome": outcome,
    },
  });
}

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getServerSupabase();
  const mode = statsForSheetMode(process.env.STATS_FOR_SHEET_MODE);
  if (mode === "legacy") {
    try {
      return response((await loadLegacyStatsForSheet(supabase)).payload, mode, "legacy");
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "legacy load failed" }, { status: 500 });
    }
  }

  if (mode === "optimized") {
    if (!(await optimizedGateReady(supabase))) {
      try {
        return response((await loadLegacyStatsForSheet(supabase)).payload, mode, "fallback_gate");
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "legacy load failed" }, { status: 500 });
      }
    }
    try {
      return response((await loadOptimizedStatsForSheet(supabase)).payload, mode, "optimized");
    } catch (error) {
      console.error("[stats-for-sheet] optimized RPC fallback", error instanceof Error ? error.message : "unknown error");
      try {
        return response((await loadLegacyStatsForSheet(supabase)).payload, mode, "fallback_rpc");
      } catch (legacyError) {
        return NextResponse.json({ error: legacyError instanceof Error ? legacyError.message : "legacy load failed" }, { status: 500 });
      }
    }
  }

  // Shadow always returns the legacy payload. A changed WAL watermark makes the
  // comparison inconclusive instead of treating concurrent collection as drift.
  const beforeWatermark = await readStatsForSheetWatermark(supabase);
  const legacyStarted = Date.now();
  let legacy: StatsForSheetLoad;
  try {
    legacy = await loadLegacyStatsForSheet(supabase);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "legacy load failed" }, { status: 500 });
  }
  const legacyMs = Date.now() - legacyStarted;
  const optimizedStarted = Date.now();
  let comparison: StatsForSheetComparison | undefined;
  let optimized: StatsForSheetLoad | undefined;
  let optimizedError = false;
  try {
    optimized = await loadOptimizedStatsForSheet(supabase);
    comparison = compareStatsForSheetPayloads(legacy.payload, optimized.payload);
  } catch (error) {
    optimizedError = true;
    console.error("[stats-for-sheet] shadow RPC failed", error instanceof Error ? error.message : "unknown error");
  }
  const optimizedMs = Date.now() - optimizedStarted;
  const afterWatermark = await readStatsForSheetWatermark(supabase);
  const stableSnapshot = beforeWatermark !== null && beforeWatermark === afterWatermark;
  const sourceCountsEqual = optimized !== undefined
    && legacy.sourcePosts === optimized.sourcePosts && legacy.sourceStats === optimized.sourceStats;
  await recordShadowAudit(supabase, {
    comparison,
    stableSnapshot,
    optimizedError,
    sourceCountsEqual,
    legacySourcePosts: legacy.sourcePosts,
    optimizedSourcePosts: optimized?.sourcePosts,
    legacySourceStats: legacy.sourceStats,
    optimizedSourceStats: optimized?.sourceStats,
    legacyMs,
    optimizedMs,
  });

  if (!stableSnapshot) return response(legacy.payload, mode, "shadow_inconclusive");
  if (comparison?.equal === true && sourceCountsEqual) return response(legacy.payload, mode, "shadow_match");
  return response(legacy.payload, mode, "shadow_mismatch");
}
