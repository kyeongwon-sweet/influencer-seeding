import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appsScript = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8");

function slice(startMarker: string, endMarker: string): string {
  const start = appsScript.indexOf(startMarker);
  const end = appsScript.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `코드 조각을 찾지 못함: ${startMarker}`);
  return appsScript.slice(start, end);
}

test("Apps Script linkKey_ keeps distinct YouTube watch IDs separate and merges same-ID URL variants", () => {
  const identityHelpers = slice("function urlKey_(u)", "function isTikTokShortLink_(u)");
  const linkKey = new Function(`${identityHelpers}; return linkKey_;`)() as (url: string) => string;

  const firstId = "AbCdEf12345";
  const secondId = "ZyXwVu98765";
  const firstWatch = `https://www.youtube.com/watch?v=${firstId}`;
  const secondWatch = `https://www.youtube.com/watch?v=${secondId}`;

  assert.notEqual(linkKey(firstWatch), linkKey(secondWatch), "서로 다른 watch?v= 영상은 중복이면 안 됨");
  assert.equal(linkKey(firstWatch), `yt:${firstId}`);
  for (const sameVideo of [
    `https://youtube.com/watch?feature=share&v=${firstId}&t=30`,
    `HTTPS://WWW.YOUTUBE.COM/WATCH?feature=share&v=${firstId}`,
    `https://youtu.be/${firstId}?si=share-token`,
    `https://www.youtube.com/shorts/${firstId}/?feature=share`,
    `yt:${firstId}`,
  ]) {
    assert.equal(linkKey(sameVideo), `yt:${firstId}`, `같은 영상 변형은 같은 키여야 함: ${sameVideo}`);
  }
});

test("identity-sensitive sheet paths use linkKey_ instead of query-stripping urlKey_", () => {
  const collectRows = slice("function collectRows_(onlyNew)", "function urlKey_(u)");
  assert.match(collectRows, /const key = linkKey_\(url\)/);
  assert.doesNotMatch(collectRows, /urlKey_\(/);

  const stableRows = slice("function assertSyncRowsStable_(sheet, rowRefs, expectedLastRow)", "function ensureMetricFormulasForRows_");
  assert.match(stableRows, /const currentKey = linkKey_\(sheet\.getRange\(ref\.row, urlCol\)\.getValue\(\)\)/);
  assert.doesNotMatch(stableRows, /urlKey_\(/);

  const importStats = slice("function importStats(source)", "function previewNew()");
  assert.match(importStats, /const key = linkKey_\(url\)/);
  assert.match(importStats, /const k = linkKey_\(s\.url\)/);
  assert.doesNotMatch(importStats, /urlKey_\(/);

  const checkDuplicates = slice("function checkDuplicates()", "function checkSheetIssues()");
  assert.match(checkDuplicates, /const key = linkKey_\(urlCheck\.url\)/);
  assert.doesNotMatch(checkDuplicates, /urlKey_\(/);
});
