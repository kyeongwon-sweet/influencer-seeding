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
  assert.match(route, /copySuspected: Array<\{ target: string;/);
  assert.match(route, /spikeSuspected: Array<\{ target: string;/);
  assert.match(route, /\$\{c\.target\} \$\{c\.date\.slice\(5, 10\)\}/);
});
