import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appsScript = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/sponsored-posts/stats-import/route.ts", import.meta.url), "utf8");
// 복사 의심 조회·판정은 2026-11-20부터 lib/stats-import-copy.ts에 있다(행동 계약: tests/stats-import-copy.test.ts).
const copyLib = readFileSync(new URL("../lib/stats-import-copy.ts", import.meta.url), "utf8");

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

test("stats-import: dailyAuto quarantines cross-post copies and spikes while manual input is preserved", () => {
  assert.match(route, /copy_suspected_skipped:\s*copySuspectedSkipped/);
  assert.match(route, /copy_suspected_warned:\s*copySuspected\.length/);
  assert.match(route, /quarantineAutomaticSuspects\(incoming, copyKeys, "play_count", isManualImport\)/);
  assert.match(route, /quarantineAutomaticSuspects\(bannerRows, copyKeys, "reach_count", isManualImport\)/);
  // 조회수·도달수 값을 두 칸 모두에서 찾고(교차 복사), 같은 날짜·값의 다른 게시물만 근거로 쓴다.
  assert.match(copyLib, /COPY_LOOKUP_COLUMNS: readonly CopyMetric\[\] = \["play_count", "reach_count"\]/);
  assert.match(copyLib, /const key = `\$\{String\(row\.measured_at\)\.slice\(0, 10\)\}\|\$\{value\}`/);
  assert.match(copyLib, /owners\.get\(`\$\{date\}\|\$\{r\.value\}`\)/);
  assert.match(copyLib, /if \(other === r\.post_id\) continue;/);
  assert.doesNotMatch(copyLib, /owners\.has\(r\.post_id\)\) continue/);
  assert.match(route, /spike_suspected_skipped:\s*spikePartition\.quarantined\.length/);
  assert.match(route, /spike_suspected_warned:\s*spikeSuspected\.length/);
  assert.match(route, /const incomingAfterSpikeGuard = spikePartition\.kept/);
  assert.match(route, /isManualImport\s*\? "수기 입력은 이 사유로 제외하지 않고 보존했습니다\."/);
});

test("stats-import: explicit non-video play is rejected but banner reach routing wins", () => {
  assert.match(route, /if \(isBannerByKey\.get\(it\.key\)\)[\s\S]*?bannerRows\.push[\s\S]*?else if \(explicitlyNonVideoKeys\.has\(it\.key\)\)/);
  assert.match(route, /non_video_play_rejected:\s*nonVideoPlayRejected\.length/);
});

test("stats-import: dailyAuto preserves existing automatic values but marks new or changed sheet values manual", () => {
  assert.match(appsScript, /function importStats\(source\)/);
  assert.match(appsScript, /importStats\("daily_auto"\)/);
  assert.match(appsScript, /source: importSource/);
  assert.match(route, /const importSource(?:: StatsImportSource)? = body\?\.source === "daily_auto" \? "daily_auto" : "manual_sheet"/);
  assert.match(route, /const isManualImport = importSource === "manual_sheet"/);
  assert.match(route, /const incomingWritable = incomingAfterSpikeGuard\.filter/);
  assert.match(route, /!manualSet\.has\(`\$\{i\.post_id\}\|\$\{i\.measured_at\}`\)/);
  assert.match(route, /resolveImportedManualFlag\(\{/);
  assert.match(route, /metric: "play_count"/);
  assert.match(route, /metric: "reach_count"/);
  assert.doesNotMatch(route, /manual: isManualImport \}\)/);
  assert.match(route, /preserved_manual: preservedManual\.length/);
});

test("stats-import: 복사 판정에 최소값·반올림 임계가 있어 작은 값 오탐을 막는다", () => {
  // 🚨 2026-08-13 실측: 임계가 없어 493행이 경고됐고 내용이 1·14·15·18 같은 한 자리·두 자리였다.
  //    그 수준의 조회수는 서로 다른 게시물이 같은 값을 갖는 게 정상이라 알림이 무의미해졌다.
  assert.match(copyLib, /export const COPY_MIN_VALUE = 1000;/);
  assert.match(copyLib, /export const COPY_ROUNDING_EXCLUDE = 100;/);
  assert.match(copyLib, /export const COPY_MIN_SHARED_DATES = 2;/);
  assert.match(copyLib, /value >= COPY_MIN_VALUE && value % COPY_ROUNDING_EXCLUDE !== 0/);
  assert.match(copyLib, /if \(!isCopyEligibleValue\(r\.value\)\) continue;/);
  // 옛 기준(반올림만 보고 최소값 없음)으로 되돌아가지 않게 고정
  assert.doesNotMatch(copyLib, /% 1000 === 0/);
  // 라우트에 옛 판정 사본이 남아 두 기준이 갈라지지 않게 한다.
  assert.doesNotMatch(route, /COPY_MIN_VALUE|COPY_ROUNDING_EXCLUDE|dvOwners/);
});

// 🚨 2026-11-18 발견: 복사 판정 조회가 정렬·페이지 없이 읽어 PostgREST 1,000행 상한에서 조용히 잘렸다
//    (11-20 실측: 조회 556번 중 202번, 최신 날짜부터). 행동 계약은 tests/stats-import-copy.test.ts.
test("stats-import: 복사 판정은 끝까지 읽는 모듈만 거치고, 조회 실패 시 일부 결과로 판정하지 않는다", () => {
  assert.match(route, /import \{ findCopySuspects, loadCopyValueOwners, type CopyCandidate \} from "@\/lib\/stats-import-copy";/);
  assert.match(route, /const \{ owners, error: copyLookupError \} = await loadCopyValueOwners\(supabase, copyCandidates\);/);
  assert.match(route, /if \(copyLookupError\) return NextResponse\.json\(\{ error: copyLookupError \}, \{ status: 500 \}\);/);
  assert.match(route, /findCopySuspects\(copyCandidates, owners\)/);
  // 모듈 쪽 조회는 끝까지 넘기고(fetchAllPages) 범위·유일 정렬 키로 끝난다.
  assert.match(copyLib, /await fetchAllPages<PageRow>\(\(from, to\) => supabase\s*\.from\("post_daily_stats"\)[\s\S]*?\.order\("id", \{ ascending: true \}\)\s*\.range\(from, to\)/);
});

test("stats-import: 라우트의 post_daily_stats 읽기는 전부 페이지를 넘긴다(1,000행 상한 무음 절단 차단)", () => {
  const unpaged: string[] = [];
  for (const match of route.matchAll(/\.from\("post_daily_stats"\)/g)) {
    const index = match.index ?? 0;
    const start = route.lastIndexOf(";", index) + 1;
    const end = route.indexOf(";", index);
    const statement = route.slice(start, end === -1 ? route.length : end + 1);
    if (/\.(upsert|insert|update|delete)\(/.test(statement)) continue; // 쓰기 문장(.select는 쓴 행 확인용)
    if (!/\.range\(/.test(statement)) unpaged.push(`line ${route.slice(0, index).split("\n").length}`);
  }
  assert.deepEqual(unpaged, [], `정렬·range 없이 읽는 post_daily_stats 조회는 1,000행에서 조용히 잘린다: ${unpaged.join(", ")}`);
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
