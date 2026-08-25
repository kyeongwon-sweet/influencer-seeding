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
  assert.match(route, /const spikeSuspected: Array<\{/);
  assert.match(route, /target: string;/);
  assert.match(route, /\$\{c\.target\} \$\{c\.date\.slice\(5, 10\)\}/);
});

test("stats-import: ended invalid TikTok URLs stay blocked without noisy alerts", () => {
  assert.match(route, /select\("url, normalized_key, ended_at"\)/);
  assert.match(route, /\.in\("normalized_key", rejectedLookupKeys\.slice/);
  assert.match(route, /buildRejectedInvalidUrlAlert\(rejectedUrls, endedRejectedIdentifiers\)/);
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

test("stats-import: 복사 판정에 최소값·반올림 임계가 있어 작은 값 오탐을 막는다", () => {
  // 🚨 2026-08-13 실측: 임계가 없어 493행이 경고됐고 내용이 1·14·15·18 같은 한 자리·두 자리였다.
  //    그 수준의 조회수는 서로 다른 게시물이 같은 값을 갖는 게 정상이라 알림이 무의미해졌다.
  assert.match(route, /const COPY_MIN_VALUE = 1000;/);
  assert.match(route, /const COPY_ROUNDING_EXCLUDE = 100;/);
  assert.match(route, /if \(r\.value < COPY_MIN_VALUE\) continue;/);
  assert.match(route, /if \(r\.value % COPY_ROUNDING_EXCLUDE === 0\) continue;/);
  // 옛 기준(반올림만 보고 최소값 없음)으로 되돌아가지 않게 고정
  assert.doesNotMatch(route, /if \(r\.value % 1000 === 0\) continue;/);
});

test("stats-import: 배너는 identity key로 분리하고 급변은 직전 자동 조회수와 비교한다", () => {
  assert.match(route, /const isBannerByKey = new Map<string, boolean>\(\)/);
  assert.match(route, /isBannerByKey\.set\(postIdentityKey\(url\) \?\? url/);
  assert.match(route, /if \(isBannerByKey\.get\(it\.key\)\)/);
  assert.doesNotMatch(route, /const maxAutoByPost/);
  assert.match(route, /const automaticPlayHistory = buildAutomaticPlayHistory\(automaticPlayRows\)/);
  assert.match(route, /previousAutomaticPlay\(automaticPlayHistory, r\.post_id, r\.measured_at\)/);
  assert.match(route, /previous_auto: previous\.play_count/);
  assert.match(route, /\.order\("post_id", \{ ascending: true \}\)[\s\S]*?\.order\("measured_at", \{ ascending: true \}\)[\s\S]*?\.range\(/);
});

test("stats-import: 시트의 배너 재분류가 즉시 우선되고 조회수 잔재를 남기지 않는다", () => {
  assert.match(route, /for \(const \[key, meta\] of postByUrl\) \{\s*isBannerByKey\.set\(key,/);
  assert.doesNotMatch(route, /if \(!isBannerByKey\.has\(key\)\)/);
  assert.match(route, /play_count: null, reach_count: it\.play_count/);
  assert.match(route, /select\("post_id, measured_at, play_count, reach_count"\)/);
  assert.match(route, /banner_reach_verified_sample:\s*bannerVerified\.slice\(0, 10\)/);
});
