import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appsScript = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/sponsored-posts/stats-import/route.ts", import.meta.url), "utf8");

test("importStats: 배너를 제외하지 않고 오늘 이하 날짜 라벨의 값들을 전송", () => {
  assert.doesNotMatch(appsScript, /if \(channelType\.indexOf\("배너"\) >= 0\) return;/);
  assert.match(appsScript, /const isBanner = channelType\.indexOf\("배너"\) >= 0;/);
  assert.match(appsScript, /if \(dc\.date > today\)/);
  assert.match(appsScript, /if \(!isBanner && prevN !== null && n === prevN\)/);
});

test("stats-import: 시트 수기 입력은 KST 당일까지 허용", () => {
  assert.match(route, /const maxStatsDate = maxDateKST\(\);/);
  assert.doesNotMatch(route, /const maxStatsDate = yesterdayKST\(\);/);
});

test("stats-import: suspicious sheet stat alerts identify the target account", () => {
  assert.match(route, /copySuspected: Array<\{[\s\S]*?target: string;/);
  assert.match(route, /spikeSuspected: Array<\{ target: string;/);
  assert.match(route, /\$\{c\.target\} \$\{c\.date\.slice\(5, 10\)\}/);
});

test("stats-import: cross-post copies and spikes are preserved with warnings", () => {
  assert.match(route, /copy_suspected_skipped:\s*0/);
  assert.match(route, /copy_suspected_warned:\s*copySuspected\.length/);
  assert.doesNotMatch(route, /incoming = incoming\.filter\(r => !copyKeys\.has\(`play_count\|/);
  assert.doesNotMatch(route, /bannerRows = bannerRows\.filter\(r => !copyKeys\.has\(`reach_count\|/);
  assert.match(route, /for \(const metric of \["play_count", "reach_count"\] as const\)/);
  assert.match(route, /const key = `\$\{String\(row\.measured_at\).*\|\$\{value\}`/s);
  assert.match(route, /dvOwners\.get\(`\$\{date\}\|\$\{r\.value\}`\)/);
  assert.doesNotMatch(route, /owners\.has\(r\.post_id\)\) continue/);
  assert.match(route, /spike_suspected_skipped:\s*0/);
  assert.match(route, /spike_suspected_warned:\s*spikeSuspected\.length/);
  assert.doesNotMatch(route, /incomingForGuard\.push\(\.\.\.kept\)/);
});

test("stats-import: dailyAuto values stay automatic and cannot overwrite human manual rows", () => {
  assert.match(appsScript, /function importStats\(source\)/);
  assert.match(appsScript, /importStats\("daily_auto"\)/);
  assert.match(appsScript, /source: importSource/);
  assert.match(route, /const importSource = body\?\.source === "daily_auto" \? "daily_auto" : "manual_sheet"/);
  assert.match(route, /const isManualImport = importSource === "manual_sheet"/);
  assert.match(route, /const incomingWritable = incomingForGuard\.filter/);
  assert.match(route, /!manualSet\.has\(`\$\{i\.post_id\}\|\$\{i\.measured_at\}`\)/);
  assert.match(route, /const statsRows = keptRows\.map\(r => \(\{ \.\.\.r, manual: isManualImport \}\)\)/);
  assert.match(route, /preserved_manual: preservedManual\.length/);
});
