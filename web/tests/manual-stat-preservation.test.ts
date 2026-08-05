import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runMonitoring = readFileSync(new URL("../../scripts/run_monitoring.py", import.meta.url), "utf8");
const apifyWebhook = readFileSync(new URL("../app/api/apify-webhook/route.ts", import.meta.url), "utf8");
const collectNow = readFileSync(new URL("../app/api/monitoring/collect-now/route.ts", import.meta.url), "utf8");

test("run_monitoring preserves same-date manual stat rows before auto upsert", () => {
  assert.match(runMonitoring, /def _filter_manual_preserved_rows/);
  assert.match(runMonitoring, /\.eq\("manual", True\)/);
  assert.match(runMonitoring, /rows = _preserve_same_date_manual_stats\(db, rows, "run_monitoring"\)/);
  assert.doesNotMatch(runMonitoring, /if existing\.get\("manual"\):\s+continue/);
  assert.match(runMonitoring, /ignore_duplicates=_should_apply_same_day_cost_guard/);
});

/**
 * 배너 도달수(reach) 쓰기 경로는 **banner-reach-sync(시트 per-date → DB) 하나뿐**이다.
 *
 * 이력: run_monitoring이 `sponsored_posts.reach_count`를 매일 `post_daily_stats`로 스냅샷했는데,
 * 팀이 입력하지 않은 날(금/토 등)까지 자동으로 채우고 잘못 배정된 reach(7,834·15,668)를 전파했다.
 * 2026-08-05 `e9a0331`에서 그 자동 스냅샷을 제거했다(단일경로화).
 *
 * 이 테스트는 **그 자동채움이 되살아나는 것을 막는다.** 예전 계약("reach_rows 보존 호출이 있어야
 * 한다")은 자동 스냅샷이 있다는 전제였으므로 더 이상 유효하지 않다.
 */
test("run_monitoring does not auto-snapshot banner reach (single writer = banner-reach-sync)", () => {
  // reach 행을 만들어 upsert하던 코드가 없어야 한다.
  assert.doesNotMatch(runMonitoring, /reach_rows\s*=\s*\[/);
  assert.doesNotMatch(runMonitoring, /upsert\(reach_rows/);
  // 왜 없는지가 코드에 남아 있어야 한다(다음 사람이 무심코 되살리지 않게).
  assert.match(runMonitoring, /배너 도달수 자동 스냅샷 비활성화/);
  assert.match(runMonitoring, /banner-reach-sync/);
});

test("apify webhook skips same-date manual rows before post_daily_stats upsert", () => {
  assert.match(apifyWebhook, /const sameDateManual = new Set<string>\(\)/);
  assert.match(apifyWebhook, /s\.manual && String\(s\.measured_at\)\.slice\(0, 10\) === today/);
  assert.match(apifyWebhook, /const rowsToUpsert = rows\.filter/);
  assert.match(apifyWebhook, /\.upsert\(rowsToUpsert, \{/);
  assert.match(apifyWebhook, /manual stat preservation preflight failed/);
  assert.match(apifyWebhook, /ignoreDuplicates: true/);
  assert.match(apifyWebhook, /manual_preserved: manualPreserved/);
});

test("collect-now skips same-date manual rows before post_daily_stats upsert", () => {
  assert.match(collectNow, /const sameDateManual = new Set<string>\(\)/);
  assert.match(collectNow, /\.eq\("measured_at", measuredAt\)/);
  assert.match(collectNow, /\.eq\("manual", true\)/);
  assert.match(collectNow, /const statsToUpsert = statsToInsert\.filter/);
  assert.match(collectNow, /\.upsert\(statsToUpsert, \{/);
  assert.match(collectNow, /manual stat preservation preflight failed/);
  assert.match(collectNow, /ignoreDuplicates: true/);
  assert.match(collectNow, /manual_preserved: manualPreserved/);
});
