import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-10-13 재발: 시트에 vt.tiktok.com 단축링크로 넣은 위성 틱톡 8건을 서버는 풀어 정식 주소로 DB에
// 저장했고, Apps Script는 못 풀어 pullFromDB가 정식 주소 행 8개를 시트 끝에 또 붙였다.
// 여기서는 Apps Script 실물 코드를 가짜 시트·가짜 UrlFetchApp 위에서 실제로 돌려 계약을 고정한다.
const appsScript = readFileSync(new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url), "utf8");

function slice(startMarker: string, endMarker: string): string {
  const start = appsScript.indexOf(startMarker);
  const end = appsScript.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `코드 조각을 찾지 못함: ${startMarker}`);
  return appsScript.slice(start, end);
}

const helpers = [
  slice("const MAX_TIKTOK_SNOWFLAKE_ =", "function isInvalidTikTokPostUrl_("),
  slice("function normalizeSheetSyncUrl_(value)", "/** TikTok 프로필·YouTube 채널처럼"),
  slice("function urlKey_(u)", "/** 링크 동일성 키"),
  slice("function linkKey_(u)", "// 🧹 중복 링크 정리"),
].join("\n");

type Cell = { value: string };

function makeHarness(urls: string[], serverResults: Array<{ input: string; resolved: string | null }> | "error") {
  const cells: Cell[] = urls.map(value => ({ value }));
  const requests: string[][] = [];
  const sheet = {
    getLastRow: () => cells.length + 1,
    getRange: (row: number, _col: number, numRows?: number) => {
      if (numRows !== undefined) {
        return { getValues: () => cells.slice(row - 2, row - 2 + numRows).map(c => [c.value]) };
      }
      const cell = cells[row - 2];
      return { getValue: () => cell.value, setValue: (v: string) => { cell.value = v; } };
    },
  };
  const env = {
    CONFIG: { DATA_START_ROW: 2, SHORT_LINK_RESOLVE_URL: "https://example.test/resolve" },
    buildFieldCols_: () => ({ url: 2 }),
    authHeaders_: () => ({ Authorization: "Bearer test" }),
    Logger: { log: () => {} },
    SpreadsheetApp: { flush: () => {} },
    UrlFetchApp: {
      fetch: (_url: string, opts: { payload: string }) => {
        requests.push(JSON.parse(opts.payload).urls);
        if (serverResults === "error") throw new Error("network down");
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ results: serverResults }) };
      },
    },
  };
  // isTikTokShortLink_ ~ shortLinkNote_ 를 한 덩어리로 꺼낸다.
  const block = slice("function isTikTokShortLink_(u)", "function removeDuplicateLinks()");
  const factory = new Function(...Object.keys(env), `${helpers}\n${block}\nreturn { resolveSheetShortLinks_, isTikTokShortLink_, shortLinkNote_ };`);
  const api = factory(...Object.values(env)) as {
    resolveSheetShortLinks_: (s: unknown) => { resolved: Array<{ row: number; to: string }>; unresolved: Array<{ row: number }>; duplicates: Array<{ row: number; others: number[] }> };
    isTikTokShortLink_: (u: string) => boolean;
    shortLinkNote_: (r: unknown) => string;
  };
  return { api, sheet, cells, requests };
}

const SHORT = "https://vt.tiktok.com/ZSboSxcJg/";
const FULL = "https://www.tiktok.com/@ssulbox_1/photo/7696140243162074388/";

test("단축링크 셀을 서버가 푼 정식 주소로 바꿔 저장한다", () => {
  const h = makeHarness(["https://www.instagram.com/p/ABC/", SHORT], [{ input: SHORT, resolved: FULL }]);
  const r = h.api.resolveSheetShortLinks_(h.sheet);
  assert.deepEqual(h.requests, [[SHORT]], "단축링크만 서버에 보낸다");
  assert.equal(h.cells[1].value, FULL);
  assert.equal(h.cells[0].value, "https://www.instagram.com/p/ABC/", "다른 행은 건드리지 않는다");
  assert.equal(r.resolved.length, 1);
  assert.equal(r.unresolved.length, 0);
  assert.equal(r.duplicates.length, 0);
});

test("못 풀면 셀을 그대로 두고 unresolved로 알린다(서버 오류 포함)", () => {
  for (const results of [[{ input: SHORT, resolved: null }], "error"] as const) {
    const h = makeHarness([SHORT], results as never);
    const r = h.api.resolveSheetShortLinks_(h.sheet);
    assert.equal(h.cells[0].value, SHORT);
    assert.deepEqual(r.unresolved.map(x => x.row), [2]);
    assert.match(h.api.shortLinkNote_(r), /못 푼 링크/);
  }
});

test("서버가 게시물 ID 없는 주소를 돌려주면 쓰지 않는다", () => {
  const h = makeHarness([SHORT], [{ input: SHORT, resolved: "https://www.tiktok.com/@ssulbox_1/" }]);
  const r = h.api.resolveSheetShortLinks_(h.sheet);
  assert.equal(h.cells[0].value, SHORT);
  assert.equal(r.unresolved.length, 1);
});

test("풀고 나니 같은 글 행이 이미 있으면 지우지 않고 행 번호를 알린다", () => {
  const h = makeHarness([SHORT, FULL], [{ input: SHORT, resolved: FULL }]);
  const r = h.api.resolveSheetShortLinks_(h.sheet);
  assert.equal(h.cells.length, 2, "행 삭제 없음");
  assert.deepEqual(r.duplicates, [{ row: 2, key: "tt:7696140243162074388", others: [3] }]);
  assert.match(h.api.shortLinkNote_(r), /2행=3행/);
});

test("단축링크 판정은 vt/vm 만 — 정식 주소·프로필은 건드리지 않는다", () => {
  const h = makeHarness([], []);
  assert.equal(h.api.isTikTokShortLink_("vt.tiktok.com/ZSboSxcJg"), true);
  assert.equal(h.api.isTikTokShortLink_("https://vm.tiktok.com/ZMabc123/"), true);
  assert.equal(h.api.isTikTokShortLink_(FULL), false);
  assert.equal(h.api.isTikTokShortLink_("https://www.tiktok.com/@sseoltteugi/"), false);
});

test("동기화와 DB→시트 가져오기 모두 단축링크를 먼저 풀고, 못 풀면 틱톡 신규 추가를 보류한다", () => {
  const runSync = slice("function runSync_(onlyNew)", "function syncNew()");
  assert.ok(runSync.indexOf("resolveSheetShortLinks_(") < runSync.indexOf("collectRows_(onlyNew)"), "syncAll/syncNew: 수집 전에 해석");

  const pull = slice("function pullFromDB()", "// 기존 URL 행만 DB 메타데이터로 보강한다");
  const resolveAt = pull.indexOf("resolveSheetShortLinks_(sheet)");
  assert.ok(resolveAt > 0 && resolveAt < pull.indexOf("const rowByKey = {}"), "pullFromDB: 시트 키 목록을 만들기 전에 해석");
  assert.match(pull, /holdTikTokAppends = shortLinks\.unresolved\.length > 0/);
  assert.match(pull, /else if \(holdTikTokAppends && \/tiktok\\\.com\/i\.test\(normalizedUrl\)\)/);
  assert.match(appsScript, /SHORT_LINK_RESOLVE_URL: "https:\/\/influencer-seeding-mu\.vercel\.app\/api\/sponsored-posts\/resolve-short-links"/);
});

test("Apps Script와 서버의 단축링크 판정이 같은 규칙이다", async () => {
  const { isTikTokShortLink } = await import("../lib/url-utils.ts");
  const h = makeHarness([], []);
  for (const u of [SHORT, "vt.tiktok.com/ZSboSxcJg", "https://vm.tiktok.com/ZMabc123/?k=1", FULL, "https://vt.tiktok.com/", "https://youtu.be/LQODaXCtlG8", ""]) {
    assert.equal(h.api.isTikTokShortLink_(u), isTikTokShortLink(u), u);
  }
});
