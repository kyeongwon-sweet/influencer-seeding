import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MAGAZINE_BANNER_FROM } from "../app/monitoring/lib.ts";
import { postIdentityKey } from "../lib/url-utils.ts";
import {
  canonicalStatsForSheetPayload,
  compareStatsForSheetPayloads,
  parseStatsForSheetPayload,
  statsForSheetMode,
  statsForSheetOptimizedGateReady,
  STATS_FOR_SHEET_RPC_CONTRACT_VERSION,
  STATS_FOR_SHEET_SHADOW_AUDIT_VERSION,
  type StatsForSheetPayload,
} from "../lib/stats-for-sheet-bundle.ts";

const route = readFileSync(
  new URL("../app/api/sponsored-posts/stats-for-sheet/route.ts", import.meta.url),
  "utf8",
);
const sql = readFileSync(
  new URL("../../supabase/migrations/20261119_stats_for_sheet_bundle.sql", import.meta.url),
  "utf8",
);

function fixture(): StatsForSheetPayload {
  return {
    posts: [
      {
        url: "https://www.instagram.com/p/B/",
        key: "ig:B",
        ended_at: null,
        stats: [["2026-11-18", 20, false, false]],
      },
      {
        url: "https://www.youtube.com/watch?v=AAAAAA",
        key: "yt:AAAAAA",
        ended_at: "2026-11-18",
        stats: [
          ["2026-11-17", 0, true, true],
          ["2026-11-18", 10, false, false],
        ],
      },
    ],
    pre_posted_dropped: 2,
    ended_without_stats: 3,
  };
}

test("stats-for-sheet mode is legacy by default and accepts only explicit rollout modes", () => {
  assert.equal(statsForSheetMode(undefined), "legacy");
  assert.equal(statsForSheetMode("garbage"), "legacy");
  assert.equal(statsForSheetMode("shadow"), "shadow");
  assert.equal(statsForSheetMode("optimized"), "optimized");
});

test("canonical comparison ignores post/stat order but includes every Apps Script field and diagnostics", () => {
  const legacy = fixture();
  const reordered: StatsForSheetPayload = {
    posts: [
      { ...legacy.posts[1], stats: [...legacy.posts[1].stats].reverse() },
      legacy.posts[0],
    ],
    pre_posted_dropped: legacy.pre_posted_dropped,
    ended_without_stats: legacy.ended_without_stats,
  };
  assert.equal(compareStatsForSheetPayloads(legacy, reordered).equal, true);

  const variants: StatsForSheetPayload[] = [
    { ...fixture(), pre_posted_dropped: 99 },
    { ...fixture(), ended_without_stats: 99 },
    { ...fixture(), posts: fixture().posts.map((p, i) => i ? p : { ...p, url: p.url + "changed" }) },
    { ...fixture(), posts: fixture().posts.map((p, i) => i ? p : { ...p, ended_at: "2026-11-19" }) },
    { ...fixture(), posts: fixture().posts.map((p, i) => i ? p : { ...p, stats: [["2026-11-18", 21, false, false]] }) },
    { ...fixture(), posts: fixture().posts.map((p, i) => i ? p : { ...p, stats: [["2026-11-18", 20, true, false]] }) },
    { ...fixture(), posts: fixture().posts.map((p, i) => i ? p : { ...p, stats: [["2026-11-18", 20, false, true]] }) },
  ];
  for (const variant of variants) assert.equal(compareStatsForSheetPayloads(legacy, variant).equal, false);
  assert.equal(canonicalStatsForSheetPayload(legacy).includes("zero"), false, "tuple position is canonical, not renamed");
});

test("optimized RPC payload validation is strict and never invents missing or invalid values", () => {
  assert.deepEqual(parseStatsForSheetPayload(fixture()), fixture());
  for (const invalid of [
    null,
    { posts: [], pre_posted_dropped: -1, ended_without_stats: 0 },
    { posts: [{ url: "x", key: "k", ended_at: null, stats: [["2026-11-18", -1, false, false]] }], pre_posted_dropped: 0, ended_without_stats: 0 },
    { posts: [{ url: "x", key: "k", ended_at: null, stats: [["2026-11-18", 1, 0, false]] }], pre_posted_dropped: 0, ended_without_stats: 0 },
    { posts: [{ url: "", key: "k", ended_at: null, stats: [] }], pre_posted_dropped: 0, ended_without_stats: 0 },
    { posts: [{ url: "x", key: "k", ended_at: "11/18", stats: [] }], pre_posted_dropped: 0, ended_without_stats: 0 },
    { posts: [
      { url: "x", key: "k", ended_at: null, stats: [] },
      { url: "y", key: "k", ended_at: null, stats: [] },
    ], pre_posted_dropped: 0, ended_without_stats: 0 },
    { posts: [{ url: "x", key: "k", ended_at: null, stats: [
      ["2026-11-18", 1, false, false], ["2026-11-18", 2, false, false],
    ] }], pre_posted_dropped: 0, ended_without_stats: 0 },
  ]) assert.throws(() => parseStatsForSheetPayload(invalid));
});

test("optimized mode requires three distinct successful KST shadow days", () => {
  const row = (day: string, equal: boolean, status = "done") => ({
    status,
    payload: {
      run_date: day,
      version: STATS_FOR_SHEET_SHADOW_AUDIT_VERSION,
      equal,
      stable_snapshot: true,
      source_counts_equal: true,
    },
  });
  assert.equal(statsForSheetOptimizedGateReady([
    row("2026-11-19", true), row("2026-11-18", true), row("2026-11-17", true),
  ]), true);
  assert.equal(statsForSheetOptimizedGateReady([
    row("2026-11-19", true), row("2026-11-18", false), row("2026-11-17", true),
  ]), false);
  assert.equal(statsForSheetOptimizedGateReady([
    row("2026-11-19", true), row("2026-11-19", true), row("2026-11-17", true),
    row("2026-11-16", true),
  ]), true);
  assert.equal(statsForSheetOptimizedGateReady([
    row("2026-11-19", true), row("2026-11-18", true, "skipped"), row("2026-11-17", true),
  ]), false);
  const unstable = row("2026-11-19", true);
  unstable.payload.stable_snapshot = false;
  assert.equal(statsForSheetOptimizedGateReady([
    unstable, row("2026-11-18", true), row("2026-11-17", true),
  ]), false);
  const incomplete = row("2026-11-19", true);
  incomplete.payload.source_counts_equal = false;
  assert.equal(statsForSheetOptimizedGateReady([
    incomplete, row("2026-11-18", true), row("2026-11-17", true),
  ]), false);
});

test("route keeps auth/no-store, hard timeout, legacy shadow response, and fail-closed optimized fallback", () => {
  assert.match(route, /checkCronAuth\(req\)/);
  assert.match(route, /"Cache-Control": "no-store"/);
  assert.match(route, /const OPTIMIZED_RPC_TIMEOUT_MS = 45_000/);
  assert.match(route, /row\.contract_version !== STATS_FOR_SHEET_RPC_CONTRACT_VERSION/);
  assert.match(route, /export const maxDuration = 300/);
  assert.match(route, /const mode = statsForSheetMode\(process\.env\.STATS_FOR_SHEET_MODE\)/);
  assert.match(route, /\.from\("jobs"\)[\s\S]*ops_marker: STATS_FOR_SHEET_SHADOW_SERVICE/);
  assert.doesNotMatch(route, /\.from\("ops_daily_runs"\)/);
  assert.match(route, /if \(mode === "optimized"\)[\s\S]*optimizedGateReady/);
  assert.match(route, /optimized RPC fallback[\s\S]*loadLegacyStatsForSheet/);
  assert.match(route, /Shadow always returns the legacy payload/);
  assert.match(route, /beforeWatermark[\s\S]*afterWatermark[\s\S]*stableSnapshot/);
  assert.match(route, /return response\(legacy\.payload, mode, "shadow_match"\)/);
});

test("RPC migration mirrors the TypeScript identity, banner, zero, aggregation, and diagnostic contracts", () => {
  assert.match(sql, /coalesce\(\s*public\.stats_for_sheet_identity_key_v1\(p\.url\),\s*btrim\(p\.url\)/s);
  assert.doesNotMatch(sql, /coalesce\(\s*public\.sponsored_post_identity_key\(p\.url\)/);
  assert.doesNotMatch(sql, /coalesce\(\s*p\.normalized_key/);
  assert.match(sql, /\(array_agg\(url order by id\)\)\[1\]/);
  assert.match(sql, /bool_or\(ended_at is null\)/);
  assert.match(sql, /max\(ended_at\)/);
  assert.match(sql, new RegExp(`date '${MAGAZINE_BANNER_FROM}'`));
  assert.match(sql, /metric = 0[\s\S]*is_youtube[\s\S]*manual or created_at >= timestamptz '2026-10-12T00:55:00Z'/);
  assert.match(sql, /max\(metric\) as metric/);
  assert.match(sql, /bool_or\(manual\) as manual/);
  assert.match(sql, /bool_or\(zero_confirmed\) as zero_confirmed/);
  assert.match(sql, /pre_posted_dropped/);
  assert.match(sql, /ended_without_stats/);
  assert.match(sql, /jsonb_agg\([\s\S]*order by post_key/);
  assert.match(sql, /source_posts bigint, source_stats bigint, contract_version integer/);
  assert.match(sql, new RegExp(`${STATS_FOR_SHEET_RPC_CONTRACT_VERSION} as contract_version`));
  assert.match(sql, /select count\(\*\)::bigint from public\.sponsored_posts/);
  assert.match(sql, /select count\(\*\)::bigint from public\.post_daily_stats/);
  assert.match(sql, /security invoker/);
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.stats_for_sheet_bundle_v1\\(\\) from ${role}`));
  }
  assert.match(sql, /grant execute on function public\.stats_for_sheet_bundle_v1\(\) to service_role/);
  assert.match(sql, /pg_current_wal_lsn\(\)/);
  for (const role of ["public", "anon", "authenticated"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.stats_for_sheet_watermark_v1\\(\\) from ${role}`));
    assert.match(sql, new RegExp(`revoke all on function public\\.stats_for_sheet_identity_key_v1\\(text\\) from ${role}`));
  }
  assert.match(sql, /grant execute on function public\.stats_for_sheet_watermark_v1\(\) to service_role/);
  assert.match(sql, /grant execute on function public\.stats_for_sheet_identity_key_v1\(text\) to service_role/);
});

test("RPC identity contract fixtures stay byte-for-byte aligned with TypeScript postIdentityKey", () => {
  const begin = sql.indexOf("-- stats_for_sheet_identity_contract_begin");
  const end = sql.indexOf("-- stats_for_sheet_identity_contract_end");
  assert.ok(begin >= 0 && end > begin);
  const block = sql.slice(begin, end);
  const fixtures = [...block.matchAll(/\('([^']*)',\s*(?:'([^']*)'|null::text)\)/g)]
    .map(match => [match[1], match[2] ?? null] as const);
  assert.equal(fixtures.length, 10);
  for (const [input, expected] of fixtures) {
    assert.equal(postIdentityKey(input), expected, input);
  }
  assert.ok(fixtures.some(([input]) => input.includes("GzdNQMv2")), "대문자 naver.me 경로 회귀 고정");
  assert.ok(fixtures.some(([input]) => input.includes("A//B?")), "generic URL 이중슬래시·쿼리 회귀 고정");
});
