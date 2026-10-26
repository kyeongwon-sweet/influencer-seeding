import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  historyBaselineRow,
  exactDashboardSummary,
  monotonicDashboardStats,
  visibleDashboardStats,
} from "../lib/monitoring-bounded-stats.ts";
import { decodeStatsV2, getFilteredStats, incrementTooltip, pickRangeStats, safeIncrement, type Post } from "../app/monitoring/lib.ts";

const post = (all_stats: Post["all_stats"], channel_type = "바이럴(영상)"): Post => ({
  id: "p1", url: "https://www.instagram.com/reel/example/", posted_at: "2026-01-01",
  product_name: "P", project_name: null, asset_name: null, creator: null, planner: null,
  account_name: "a", company_name: null, channel_type, cost: 100, reach_count: null,
  notes: null, content_summary: null, created_at: "2026-01-01T00:00:00Z", ended_at: null,
  influencers: null, latest_stats: null, prev_stats: null, all_stats,
});

test("bounded history: manual 하향 correction 뒤 mono seed와 lifetime increment max를 분리한다", () => {
  const baseline = historyBaselineRow({
    post_id: "p1", prior_play_seed: 500, prior_ig_max: 1000, prior_fb_max: 0,
  }, "2026-09-01", false)!;
  const rows = monotonicDashboardStats([
    baseline,
    { post_id: "p1", measured_at: "2026-09-01", play_count: 550, likes_count: null, comments_count: null },
    { post_id: "p1", measured_at: "2026-09-02", play_count: 1200, likes_count: null, comments_count: null },
  ]);
  assert.equal(rows[1].play_count, 550, "display mono must not resurrect the historic 1,000 after manual reset");
  assert.equal(safeIncrement(rows, rows[1], false, "2026-01-01"), 0, "legacy safeIncrement still compares with lifetime max");
  assert.equal(safeIncrement(rows, rows[2], false, "2026-01-01"), 200);
  const tooltip = incrementTooltip(post(rows), rows[2]);
  assert.match(tooltip, /과거 전체 최대: 1,000/);
  assert.match(tooltip, /= \+200/);
});

test("bounded history: IG와 FB 최대값을 서로 다른 날짜에서 합쳐 display seed로 만들지 않는다", () => {
  const baseline = historyBaselineRow({
    post_id: "p1", prior_play_seed: 1500, prior_ig_max: 900, prior_fb_max: 700,
  }, "2026-09-01", false)!;
  const rows = monotonicDashboardStats([
    baseline,
    { post_id: "p1", measured_at: "2026-09-01", play_count: 1600, fb_play_count: 700, likes_count: null, comments_count: null },
    { post_id: "p1", measured_at: "2026-09-02", play_count: 1700, fb_play_count: 800, likes_count: null, comments_count: null },
  ]);
  assert.equal(rows[0].play_count, 1500);
  assert.equal(safeIncrement(rows, rows[1], false, "2026-01-01"), 0);
  assert.equal(safeIncrement(rows, rows[2], false, "2026-01-01"), 100, "only the newly observed FB 100 is added");
});

test("bounded history: banner current seed와 historical max가 각각 display와 safe increment를 보존한다", () => {
  const baseline = historyBaselineRow({
    post_id: "p1", prior_reach_seed: 800, prior_reach_max: 1000,
  }, "2026-09-01", true)!;
  const rows = monotonicDashboardStats([
    baseline,
    { post_id: "p1", measured_at: "2026-09-01", play_count: null, reach_count: 900, likes_count: null, comments_count: null },
  ]);
  assert.equal(pickRangeStats(post([baseline], "바이럴(배너)"), "", "").s?.reach_count, 800);
  assert.equal(safeIncrement(rows, rows[1], true, "2026-01-01"), 0);
});

test("bounded history: 합성 baseline은 날짜 필터·차트 데이터에서 숨긴다", () => {
  const baseline = historyBaselineRow({
    post_id: "p1", prior_play_seed: 500, prior_ig_max: 500,
    prior_likes_seed: 17, prior_comments_seed: 4,
    prior_display_likes: 16, prior_display_comments: 3,
  }, "2026-09-01", false)!;
  const recent = { measured_at: "2026-09-01", play_count: 520, likes_count: null, comments_count: null };
  assert.deepEqual(visibleDashboardStats([baseline, recent]), [recent]);
  assert.deepEqual(getFilteredStats([baseline, recent], "", ""), [recent]);
  assert.equal(baseline.history_likes_seed, 17);
  assert.equal(baseline.history_comments_seed, 4);
  assert.equal(baseline.likes_count, 16);
  assert.equal(baseline.comments_count, 3);
});

test("full-history parity: latest·달력 전일·day7와 오래전에 종료된 글의 latest를 보존한다", () => {
  const rows = [
    { post_id: "p1", measured_at: "2026-01-06", play_count: 100, likes_count: null, comments_count: null },
    { post_id: "p1", measured_at: "2026-01-08", play_count: null, likes_count: null, comments_count: null },
    { post_id: "p1", measured_at: "2026-01-09", play_count: 130, likes_count: null, comments_count: null },
  ];
  const summary = exactDashboardSummary(rows, "2026-01-01");
  assert.equal(summary.latest_stats?.measured_at, "2026-01-09");
  assert.equal(summary.prev_stats?.measured_at, "2026-01-08");
  assert.equal(summary.prev_stats?.play_count, 100, "missing raw day still carries the legacy mono value");
  assert.equal(summary.day7_play_count, 100, "posted+7 exact row wins even when its raw play was missing");
  const endedBaseline = historyBaselineRow({
    post_id: "p1", prior_play_seed: 130, prior_ig_max: 130, prior_display_increment: 30,
    prior_display_measured_at: "2026-01-09",
  }, "2026-09-01", false)!;
  const endedPost = post([endedBaseline]);
  const endedLatest = pickRangeStats(endedPost, "", "").s;
  assert.equal(endedLatest?.play_count, 130, "old ended post does not become zero");
  assert.equal(endedLatest?.measured_at, "2026-01-09", "manual edit must target the real latest day, not cutoff-1");
  assert.equal(safeIncrement(endedPost.all_stats, endedLatest, false, endedPost.posted_at), 30);
  assert.match(incrementTooltip(endedPost, endedLatest), /전체 이력에서 계산한 실제 마지막 날 증분: 30/);
});

test("old range: lazy-loaded rows use actual historical values, never a synthetic baseline", () => {
  const baseline = historyBaselineRow({ post_id: "p1", prior_play_seed: 900, prior_ig_max: 900 }, "2026-09-01", false)!;
  const oldRows = [
    { measured_at: "2026-07-01", play_count: 400, likes_count: null, comments_count: null },
    { measured_at: "2026-07-02", play_count: 450, likes_count: null, comments_count: null },
  ];
  assert.deepEqual(getFilteredStats([baseline, ...oldRows], "2026-07-01", "2026-07-02"), oldRows);
});

test("stats_v2 decoder는 새 baseline metadata와 옛 6칸 튜플을 모두 읽는다", () => {
  const [baseline, legacy] = decodeStatsV2([
    ["2026-08-31", 500, 12, 3, null, 1, 100, 1, 450, null, 100, 12, 3, 27],
    ["2026-09-01", 520, 1, 2, null, 1],
  ]);
  assert.equal(baseline.history_baseline, true);
  assert.equal(baseline.history_ig_max, 450);
  assert.equal(baseline.history_fb_max, 100);
  assert.equal(baseline.history_likes_seed, 12);
  assert.equal(baseline.history_comments_seed, 3);
  assert.equal(baseline.history_latest_increment, 27);
  assert.equal(legacy.history_baseline, undefined);
  assert.equal(legacy.fb_play_count, null);
});

test("summary SQL 계약: KST 경계·manual reset·day7·분리 baseline을 DB 안에서 계산한다", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const sql = readFileSync(`${here}../../supabase/migrations/20261026_monitoring_dashboard_stat_summaries.sql`, "utf8");
  for (const token of ["p_from date", "p_before date", "p_created_before timestamptz", "prior_play_seed", "prior_reach_seed", "prior_ig_max", "prior_fb_max", "prior_likes_seed", "prior_comments_seed", "prior_display_measured_at", "prior_display_increment", "day7_play_count", "s.manual is true", "s.measured_at < p_before", "s.created_at <= p_created_before"]) {
    assert.ok(sql.includes(token), `missing SQL contract token: ${token}`);
  }
  assert.doesNotMatch(sql, /current_date|now\(\)/i, "business-day boundary must come from KST app helper");
  assert.match(sql, /revoke all on function public\.monitoring_dashboard_stat_summaries_v1\(date, date, timestamptz\) from public/i);
  assert.match(sql, /from anon/i);
  assert.match(sql, /from authenticated/i);
  assert.match(sql, /grant execute on function public\.monitoring_dashboard_stat_summaries_v1\(date, date, timestamptz\) to service_role/i);
});

test("rollout 계약: legacy가 기본이고 shadow·bounded만 명시 활성화하며 RPC는 1,000행을 페이지네이션한다", () => {
  const here = fileURLToPath(new URL(".", import.meta.url));
  const route = readFileSync(`${here}../app/api/sponsored-posts/route.ts`, "utf8");
  assert.match(route, /MONITORING_DASHBOARD_HISTORY_MODE\s*\?\?\s*"legacy"/);
  assert.match(route, /configured === "bounded" \|\| configured === "shadow"/);
  assert.match(route, /for \(let from = 0; ; from \+= SUMMARY_PAGE\)/);
  assert.match(route, /\.order\("id", \{ ascending: true \}\)\s*\.range\(from, from \+ SUMMARY_PAGE - 1\)/s);
  assert.match(route, /summary coverage mismatch/);
  assert.match(route, /\.lte\("created_at", statsSnapshot\)/,
    "count and page reads must share an immutable snapshot watermark");
  assert.match(route, /loadedStatKeys\.size !== expectedStatCount/,
    "successful offset pages still need an exact unique-row coverage check");
  assert.match(route, /bounded history shadow mismatch; legacy response retained/);
  assert.match(route, /const useBounded = rollout === "bounded" && !summaries\.error/);
  assert.match(route, /useBounded && partial[\s\S]*status: 503/,
    "a missing recent page must fail explicitly instead of rendering unloaded history as zero");
});
