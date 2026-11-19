export type StatsForSheetTuple = readonly [string, number, boolean, boolean];

export type StatsForSheetPost = {
  url: string;
  key: string;
  ended_at: string | null;
  stats: StatsForSheetTuple[];
};

export type StatsForSheetPayload = {
  posts: StatsForSheetPost[];
  pre_posted_dropped: number;
  ended_without_stats: number;
};

export type StatsForSheetMode = "legacy" | "shadow" | "optimized";

export type StatsForSheetComparison = {
  equal: boolean;
  legacyCanonical: string;
  optimizedCanonical: string;
  legacyPosts: number;
  optimizedPosts: number;
  legacyStats: number;
  optimizedStats: number;
};

export type StatsForSheetShadowAuditRow = {
  status?: unknown;
  payload?: unknown;
};

export const STATS_FOR_SHEET_SHADOW_SERVICE = "stats-for-sheet-shadow-v1";
// Bump this together with the SQL contract_version for every identity, metric,
// grouping, diagnostic, or payload-policy change. Old shadow days must never
// authorize a meaningfully different optimized contract.
export const STATS_FOR_SHEET_RPC_CONTRACT_VERSION = 1;
export const STATS_FOR_SHEET_SHADOW_AUDIT_VERSION = STATS_FOR_SHEET_RPC_CONTRACT_VERSION;
export const STATS_FOR_SHEET_REQUIRED_SHADOW_MATCHES = 3;

export function statsForSheetMode(raw: string | null | undefined): StatsForSheetMode {
  return raw === "shadow" || raw === "optimized" ? raw : "legacy";
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteCount(value: unknown, name: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`stats-for-sheet ${name} must be a non-negative safe integer`);
  }
  return count;
}

/** Validate the one-row RPC payload before it can reach Apps Script. */
export function parseStatsForSheetPayload(value: unknown): StatsForSheetPayload {
  const root = recordOf(value);
  if (!root || !Array.isArray(root.posts)) {
    throw new Error("stats-for-sheet payload must contain posts[]");
  }

  const seenKeys = new Set<string>();
  const posts = root.posts.map((rawPost, postIndex): StatsForSheetPost => {
    const post = recordOf(rawPost);
    if (!post || typeof post.url !== "string" || typeof post.key !== "string" || !Array.isArray(post.stats)) {
      throw new Error(`stats-for-sheet post[${postIndex}] has an invalid shape`);
    }
    if (!post.url.trim() || !post.key.trim() || seenKeys.has(post.key)) {
      throw new Error(`stats-for-sheet post[${postIndex}] has an empty or duplicate identity`);
    }
    seenKeys.add(post.key);
    if (post.ended_at !== null && (typeof post.ended_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(post.ended_at))) {
      throw new Error(`stats-for-sheet post[${postIndex}].ended_at is invalid`);
    }
    let previousDate = "";
    const stats = post.stats.map((rawStat, statIndex): StatsForSheetTuple => {
      if (!Array.isArray(rawStat) || rawStat.length !== 4 || typeof rawStat[0] !== "string"
          || !/^\d{4}-\d{2}-\d{2}$/.test(rawStat[0]) || rawStat[0] <= previousDate
          || typeof rawStat[1] !== "number" || typeof rawStat[2] !== "boolean"
          || typeof rawStat[3] !== "boolean") {
        throw new Error(`stats-for-sheet post[${postIndex}].stats[${statIndex}] has an invalid shape`);
      }
      previousDate = rawStat[0];
      const metric = rawStat[1];
      if (!Number.isFinite(metric) || metric < 0) {
        throw new Error(`stats-for-sheet post[${postIndex}].stats[${statIndex}] has an invalid metric`);
      }
      return [rawStat[0], metric, rawStat[2], rawStat[3]];
    });
    return {
      url: post.url,
      key: post.key,
      ended_at: post.ended_at,
      stats,
    };
  });

  return {
    posts,
    pre_posted_dropped: finiteCount(root.pre_posted_dropped, "pre_posted_dropped"),
    ended_without_stats: finiteCount(root.ended_without_stats, "ended_without_stats"),
  };
}

/**
 * Stable, order-independent representation used only for shadow comparison.
 * It includes every field consumed by Apps Script and both diagnostic counts.
 */
export function canonicalStatsForSheetPayload(payload: StatsForSheetPayload): string {
  const posts = payload.posts.map(post => ({
    url: post.url,
    key: post.key,
    ended_at: post.ended_at,
    stats: [...post.stats]
      .map(stat => [...stat] as [string, number, boolean, boolean])
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]
        || Number(a[2]) - Number(b[2]) || Number(a[3]) - Number(b[3])),
  })).sort((a, b) => a.key.localeCompare(b.key) || a.url.localeCompare(b.url)
    || String(a.ended_at ?? "").localeCompare(String(b.ended_at ?? "")));

  return JSON.stringify({
    posts,
    pre_posted_dropped: payload.pre_posted_dropped,
    ended_without_stats: payload.ended_without_stats,
  });
}

export function compareStatsForSheetPayloads(
  legacy: StatsForSheetPayload,
  optimized: StatsForSheetPayload,
): StatsForSheetComparison {
  const legacyCanonical = canonicalStatsForSheetPayload(legacy);
  const optimizedCanonical = canonicalStatsForSheetPayload(optimized);
  return {
    equal: legacyCanonical === optimizedCanonical,
    legacyCanonical,
    optimizedCanonical,
    legacyPosts: legacy.posts.length,
    optimizedPosts: optimized.posts.length,
    legacyStats: legacy.posts.reduce((sum, post) => sum + post.stats.length, 0),
    optimizedStats: optimized.posts.reduce((sum, post) => sum + post.stats.length, 0),
  };
}

/** Optimized mode stays fail-closed until three distinct KST shadow days matched. */
export function statsForSheetOptimizedGateReady(rows: StatsForSheetShadowAuditRow[]): boolean {
  const days = new Set<string>();
  for (const row of rows) {
    const payload = recordOf(row.payload);
    const day = String(payload?.run_date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || days.has(day)) continue;
    days.add(day);
    if (row.status !== "done" || payload?.version !== STATS_FOR_SHEET_SHADOW_AUDIT_VERSION
        || payload?.equal !== true || payload?.stable_snapshot !== true
        || payload?.source_counts_equal !== true) {
      return false;
    }
    if (days.size === STATS_FOR_SHEET_REQUIRED_SHADOW_MATCHES) return true;
  }
  return false;
}
