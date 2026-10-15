import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isBannerChannel } from "../app/monitoring/lib.ts";

test("recognizes explicit banners and applies the magazine posted-date boundary", () => {
  assert.equal(isBannerChannel("바이럴 (배너)"), true);
  assert.equal(isBannerChannel("Viral Banner"), true);
  assert.equal(isBannerChannel("바이럴 (영상)"), false);
  // 게시일 경계 이전이라도 명시적으로 배너 분류한 영상 포함 캐러셀은 도달수다.
  assert.equal(isBannerChannel("협찬 (파워채널/매거진 배너)", "2026-08-07"), true);
  assert.equal(isBannerChannel("협찬 (파워채널/매거진)", "2026-06-30"), false);
  assert.equal(isBannerChannel("협찬 (파워채널/매거진)", "2026-08-18"), true);
  assert.equal(isBannerChannel("협찬 (파워채널/매거진)"), false);
  assert.equal(isBannerChannel(null), false);
});

test("collection entry points use the canonical posted-date-aware banner rule", () => {
  for (const file of [
    "app/api/apify-webhook/route.ts",
    "app/api/monitoring/collect-now/route.ts",
  ]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /isBannerChannel\(post\.channel_type, post\.posted_at\)/, file);
    assert.doesNotMatch(source, /isBannerChannelType/, file);
    assert.doesNotMatch(
      source,
      /isBannerChannel\(post\.channel_type, post\.posted_at\)[^\n]*tiktok\.com/,
      `${file}: Instagram-only writer must not retain a TikTok banner exception`,
    );
  }
});

test("Python collector stores TikTok banner metrics in reach while keeping non-TikTok banners manual", () => {
  const source = fs.readFileSync(
    new URL("../../scripts/run_monitoring.py", import.meta.url),
    "utf8",
  );
  assert.match(source, /is_tiktok_banner\s*=\s*is_banner\s+and\s+"tiktok\.com"/);
  assert.match(source, /"reach_count"\s+if\s+is_tiktok_banner/);
  assert.match(source, /else\s+\(None\s+if\s+is_banner\s+else\s+"play_count"\)/);
  assert.match(source, /row\["play_count"\]\s*=\s*None/);
});

test("TikTok banner metric migration moves play to reach atomically", () => {
  const sql = fs.readFileSync(
    new URL("../../supabase/migrations/20261015_tiktok_banner_metric_to_reach.sql", import.meta.url),
    "utf8",
  );
  assert.match(sql, /lock table public\.post_daily_stats/i);
  assert.match(sql, /s\.play_count is not null[\s\S]*?s\.reach_count is not null/);
  assert.match(sql, /set reach_count = s\.play_count,[\s\S]*?play_count = null/i);
  assert.match(sql, /TikTok banner metric migration verification failed/);
  assert.match(sql, /\bbegin;[\s\S]*?\bcommit;/i);
});
