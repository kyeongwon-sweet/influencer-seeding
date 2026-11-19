import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  lookupExistingSponsoredRows,
  type SponsoredLookupExistingRow,
  type SponsoredLookupFetch,
  type SponsoredLookupInputRow,
} from "../lib/sponsored-existing-lookup.ts";

const keyFromUrl = (url: string): string | null => {
  const match = url.match(/\/p\/(\d+)\/?$/);
  return match ? `ig:${match[1]}` : null;
};

function input(id: number, url = `https://www.instagram.com/p/${id}/`): SponsoredLookupInputRow {
  return { url, normalized_key: `ig:${id}` };
}

function existing(id: number, extra: Record<string, unknown> = {}): SponsoredLookupExistingRow {
  return {
    id: `db-${id}`,
    url: `https://www.instagram.com/p/${id}/`,
    normalized_key: `ig:${id}`,
    manual_fields: [],
    ...extra,
  };
}

function fakeFetcher(database: SponsoredLookupExistingRow[], calls: Array<{ column: string; values: string[] }>): SponsoredLookupFetch {
  return async (column, values) => {
    calls.push({ column, values: [...values] });
    return {
      data: database.filter(row => values.includes(String(row[column] ?? ""))),
      error: null,
    };
  };
}

async function legacyDoubleLookup(
  rows: SponsoredLookupInputRow[],
  fetchRows: SponsoredLookupFetch,
): Promise<{ byUrl: Map<string, SponsoredLookupExistingRow>; byIdentity: Map<string, SponsoredLookupExistingRow> }> {
  const byUrl = new Map<string, SponsoredLookupExistingRow>();
  const byIdentity = new Map<string, SponsoredLookupExistingRow>();
  const keys = rows.map(row => row.normalized_key).filter((key): key is string => Boolean(key));
  for (let i = 0; i < keys.length; i += 80) {
    const { data, error } = await fetchRows("normalized_key", keys.slice(i, i + 80));
    assert.equal(error, null);
    for (const row of data ?? []) {
      const url = String(row.url);
      byUrl.set(url, row);
      byIdentity.set(String(row.normalized_key ?? keyFromUrl(url) ?? row.url), row);
    }
  }
  const urls = rows.map(row => row.url);
  for (let i = 0; i < urls.length; i += 80) {
    const { data, error } = await fetchRows("url", urls.slice(i, i + 80));
    assert.equal(error, null);
    for (const row of data ?? []) {
      const url = String(row.url);
      byUrl.set(url, row);
      byIdentity.set(keyFromUrl(url) ?? url, row);
    }
  }
  return { byUrl, byIdentity };
}

function mapIds(map: Map<string, SponsoredLookupExistingRow>): Array<[string, string]> {
  return [...map].map(([key, row]) => [key, String(row.id)] as [string, string]).sort(([a], [b]) => a.localeCompare(b));
}

test("실제 sheet bulk writer가 최적화된 lookup 결과와 기존 오류 가드를 사용한다", () => {
  const source = readFileSync(new URL("../lib/sponsored-write.ts", import.meta.url), "utf8");
  assert.match(source, /lookupExistingSponsoredRows\(\s*rows,/);
  assert.match(source, /existingByUrl,\s*existingByIdentity,\s*supportsNormalizedKey,/);
  assert.match(source, /if \(existingLookupError\) \{\s*return \{ error: `\[조회\]/);
  assert.doesNotMatch(source, /for \(let i = 0; i < allUrls\.length; i \+= 80\)/);
});

test("전체 행이 normalized_key로 매칭되면 URL 조회를 0회로 줄인다", async () => {
  const rows = Array.from({ length: 5_572 }, (_, index) => input(index + 1));
  const database = Array.from({ length: 5_572 }, (_, index) => existing(index + 1));
  const calls: Array<{ column: string; values: string[] }> = [];

  const result = await lookupExistingSponsoredRows(rows, fakeFetcher(database, calls), keyFromUrl);

  assert.equal(result.existingByIdentity.size, 5_572);
  assert.equal(result.normalizedKeyQueries, 70);
  assert.equal(result.urlFallbackQueries, 0);
  assert.equal(calls.filter(call => call.column === "normalized_key").length, 70);
  assert.equal(calls.filter(call => call.column === "url").length, 0);
  // 기존 구현은 같은 5,572행을 key 70회 + URL 70회 읽었다.
  assert.equal(result.normalizedKeyQueries + result.urlFallbackQueries, 70);
  assert.equal(Math.ceil(rows.length / 80) * 2, 140);
});

test("혼합 배치에서는 키 미매칭 게시물 URL만 fallback 조회한다", async () => {
  const rows = Array.from({ length: 200 }, (_, index) => input(index + 1));
  const keyMatched = Array.from({ length: 150 }, (_, index) => existing(index + 1));
  const legacy = Array.from({ length: 50 }, (_, index) => {
    const id = index + 151;
    return existing(id, { normalized_key: null });
  });
  const calls: Array<{ column: string; values: string[] }> = [];

  const result = await lookupExistingSponsoredRows(rows, fakeFetcher([...keyMatched, ...legacy], calls), keyFromUrl);

  assert.equal(result.existingByIdentity.size, 200);
  assert.equal(result.normalizedKeyQueries, 3);
  assert.equal(result.urlFallbackQueries, 1);
  const urlCalls = calls.filter(call => call.column === "url");
  assert.deepEqual(urlCalls.flatMap(call => call.values), rows.slice(150).map(row => row.url));
  assert.equal(urlCalls.flatMap(call => call.values).some(url => rows.slice(0, 150).some(row => row.url === url)), false);
});

test("정상·legacy·신규가 섞인 배치의 매칭 및 신규 판정은 기존 이중 조회와 같다", async () => {
  const rows = Array.from({ length: 210 }, (_, index) => input(index + 1));
  const database = [
    ...Array.from({ length: 150 }, (_, index) => existing(index + 1)),
    ...Array.from({ length: 50 }, (_, index) => existing(index + 151, { normalized_key: null })),
  ];
  const oldCalls: Array<{ column: string; values: string[] }> = [];
  const newCalls: Array<{ column: string; values: string[] }> = [];

  const oldResult = await legacyDoubleLookup(rows, fakeFetcher(database, oldCalls));
  const newResult = await lookupExistingSponsoredRows(rows, fakeFetcher(database, newCalls), keyFromUrl);
  const oldCreates = rows.filter(row => !oldResult.byIdentity.has(row.normalized_key ?? row.url) && !oldResult.byUrl.has(row.url));
  const newCreates = rows.filter(row => !newResult.existingByIdentity.has(row.normalized_key ?? row.url) && !newResult.existingByUrl.has(row.url));

  assert.deepEqual(mapIds(newResult.existingByUrl), mapIds(oldResult.byUrl));
  assert.deepEqual(mapIds(newResult.existingByIdentity), mapIds(oldResult.byIdentity));
  assert.deepEqual(newCreates.map(row => row.normalized_key), oldCreates.map(row => row.normalized_key));
  assert.deepEqual(newCreates.map(row => row.normalized_key), Array.from({ length: 10 }, (_, index) => `ig:${index + 201}`));
  assert.equal(oldCalls.length, 6);
  assert.equal(newCalls.length, 4);
});

test("중복 identity 입력은 key와 URL 쿼리를 중복시키지 않고 key 매칭을 우선한다", async () => {
  const rows: SponsoredLookupInputRow[] = [
    input(1, "https://www.instagram.com/p/1/"),
    input(1, "https://www.instagram.com/reel/1/"),
    input(1, "https://instagram.com/tv/1/"),
  ];
  const keyMatch = existing(1, { url: "https://legacy.example/key-match/" });
  const misleadingUrlRow = existing(999, {
    id: "url-only",
    url: rows[0].url,
    normalized_key: "ig:OTHER",
  });
  const calls: Array<{ column: string; values: string[] }> = [];

  const result = await lookupExistingSponsoredRows(rows, fakeFetcher([keyMatch, misleadingUrlRow], calls), keyFromUrl);

  assert.equal(result.normalizedKeyQueries, 1);
  assert.equal(result.urlFallbackQueries, 0);
  assert.equal(calls[0]?.values.length, 1);
  assert.equal(result.existingByIdentity.get("ig:1")?.id, "db-1");
});

test("normalized_key가 NULL인 legacy 행은 정확한 URL fallback으로 계속 찾는다", async () => {
  const rows = [input(42)];
  const legacy = existing(42, { normalized_key: null, manual_fields: ["cost"] });
  const calls: Array<{ column: string; values: string[] }> = [];

  const result = await lookupExistingSponsoredRows(rows, fakeFetcher([legacy], calls), keyFromUrl);

  assert.equal(result.supportsNormalizedKey, true);
  assert.equal(result.normalizedKeyQueries, 1);
  assert.equal(result.urlFallbackQueries, 1);
  assert.equal(result.existingByUrl.get(rows[0].url)?.id, "db-42");
  assert.equal(result.existingByIdentity.get("ig:42")?.id, "db-42");
});

test("normalized_key 조회가 지원되지 않으면 모든 URL fallback과 legacy create 모드를 보존한다", async () => {
  const rows = Array.from({ length: 161 }, (_, index) => input(index + 1));
  const database = Array.from({ length: 161 }, (_, index) => existing(index + 1, { normalized_key: null }));
  const calls: Array<{ column: string; values: string[] }> = [];
  const fetchRows: SponsoredLookupFetch = async (column, values) => {
    calls.push({ column, values: [...values] });
    if (column === "normalized_key") {
      return { data: null, error: { message: "column normalized_key does not exist", code: "42703" } };
    }
    return {
      data: database.filter(row => values.includes(String(row.url))),
      error: null,
    };
  };

  const result = await lookupExistingSponsoredRows(rows, fetchRows, keyFromUrl);

  assert.equal(result.supportsNormalizedKey, false);
  assert.equal(result.normalizedKeyQueries, 1);
  assert.equal(result.urlFallbackQueries, 3);
  assert.equal(result.existingByIdentity.size, 161);
  assert.deepEqual(calls.filter(call => call.column === "url").flatMap(call => call.values), rows.map(row => row.url));
});

test("URL fallback 오류는 쓰기 전에 그대로 반환하고 이후 청크를 실행하지 않는다", async () => {
  const rows = Array.from({ length: 100 }, (_, index) => input(index + 1));
  const calls: Array<{ column: string; values: string[] }> = [];
  const fetchRows: SponsoredLookupFetch = async (column, values) => {
    calls.push({ column, values: [...values] });
    if (column === "url") return { data: null, error: { message: "temporary DB error", code: "XX001" } };
    return { data: [], error: null };
  };

  const result = await lookupExistingSponsoredRows(rows, fetchRows, keyFromUrl);

  assert.equal(result.urlError?.message, "temporary DB error");
  assert.equal(result.normalizedKeyQueries, 2);
  assert.equal(result.urlFallbackQueries, 1);
  assert.equal(calls.length, 3);
});
