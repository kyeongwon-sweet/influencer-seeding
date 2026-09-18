import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeTrends, dateOffset, parseContent, parseGroups, parseTrendDataset, trendSummary, trendsUrl, validateConfig, validateResult, type TrackerConfig, type TrackerResult } from "../lib/google-search-tracker.ts";
const config: TrackerConfig = { groups: parseGroups("브랜드=라라스윗\n멜론=멜론쫀득바,라라스윗멜론쫀득바|멜론쫀득바"), start: "2026-06-29", end: "2026-09-14", geo: "KR", category: "71", multiplier: 2.5, minIndex: 5, gapDays: 7, windowDays: 7 };
const point = (date: string, value: unknown[], hasData?: boolean[], isPartial?: boolean) => ({ time: String(Date.parse(date) / 1000), value, hasData, isPartial });
test("one comparison request preserves OR groups and a shared normalization window", () => {
  const url = new URL(trendsUrl(config));
  assert.equal(url.searchParams.get("q"), "라라스윗,멜론쫀득바 + 라라스윗멜론쫀득바");
  assert.equal(url.searchParams.get("date"), "2026-06-01 2026-09-14");
  assert.equal(url.searchParams.get("cat"), "71");
  assert.equal(validateConfig({ ...config, category: undefined }).category, "0");
  assert.throws(() => validateConfig({ ...config, category: "999999" }), /카테고리/);
  assert.throws(() => parseGroups("x=a\nx=b"));
  assert.throws(() => validateConfig({ ...config, multiplier: NaN }));
  assert.throws(() => validateConfig({ ...config, start: "2026-02-30" }));
  const large = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, label: `group${i}`, terms: Array.from({ length: 25 }, (_, j) => "가".repeat(77) + j), tags: [] }));
  assert.throws(() => validateConfig({ ...config, groups: large }), /설정이 너무 큽니다/);
});
test("real actor response: hasData=false stays null; genuine zero stays zero; partial is omitted", () => {
  const r = parseTrendDataset([{ searchTerm: "라라스윗,멜론쫀득바 + 라라스윗멜론쫀득바", interestOverTime_timelineData: [point("2026-06-29", [43, 0], [true, false]), point("2026-06-30", [0, 0], [true, false]), point("2026-07-01", [100, 90], [true, true], true)], interestBySubregion: [{ geoCode: "KR-11", geoName: "서울특별시", value: [100, 0], hasData: [true, true] }, { geoCode: "KR-26", geoName: "부산광역시", value: [0, 0], hasData: [false, true] }] }], config);
  assert.deepEqual(r.points.map(p => p.values), [[43, null], [0, null]]);
  assert.equal(r.regionLevel, "시·도");
  assert.deepEqual(r.regions, [{ geoCode: "KR-11", geoName: "서울특별시", values: [100, 0] }, { geoCode: "KR-26", geoName: "부산광역시", values: [null, 0] }]);
  assert.equal(trendSummary(r, config, 0).mean, 21.5);
  assert.equal(trendSummary(r, config, 1).mean, null);
  assert.match(r.warnings.join(" "), /멜론: 유효 표본이 없습니다/);
  assert.throws(() => parseTrendDataset([], config), /유효한 데이터/);
  assert.throws(() => parseTrendDataset([{ searchTerm: "라라스윗", interestOverTime_timelineData: [point("2026-06-29", [10], [true])] }], config), /일부 상품/);
});
test("weekly observations remain weekly, with no synthetic daily values", () => {
  const r = parseTrendDataset([{ searchTerm: "compare", interestOverTime_timelineData: [point("2026-06-29", [10, 1]), point("2026-07-06", [20, 2]), point("2026-07-13", [50, 5])] }], config);
  assert.equal(r.granularity, "주별"); assert.equal(r.points.length, 3);
  assert.throws(() => validateResult({ ...r, points: [...r.points, r.points[0]] }, config), /중복/);
  const monthly = parseTrendDataset([{ searchTerm: "compare", interestOverTime_timelineData: [point("2026-06-29", [10, 1]), point("2026-07-29", [20, 2]), point("2026-08-29", [100, 5])] }], config);
  assert.equal(monthly.granularity, "월별"); assert.equal(analyzeTrends(monthly, config).length, 0); assert.match(monthly.warnings.join(" "), /28일 표본이 부족/);
});
test("spike baseline uses prior 28 calendar days, excludes null and the current point", () => {
  const r: TrackerResult = { points: Array.from({ length: 41 }, (_, i) => ({ date: dateOffset("2026-06-01", i), values: [i < 28 ? 10 : i === 28 || i === 32 || i === 36 ? 100 : null, null] })), regions: [], regionLevel: "", collectedAt: "", granularity: "일별", sourceUrl: "", warnings: [] };
  const e = analyzeTrends(r, config);
  assert.equal(e.length, 1); assert.equal(e[0].date, "2026-06-29"); assert.equal(e[0].baseline, 10); assert.equal(e[0].change, 900); assert.equal(e[0].kind, "지속 상승");
  const none = { ...r, points: r.points.map(p => ({ ...p, values: [null, null] })) };
  assert.equal(analyzeTrends(none, config).length, 0);
  const zero = { ...r, points: r.points.map((p, i) => ({ ...p, values: [i < 28 ? 0 : i === 28 ? 20 : null, null] })) };
  assert.equal(analyzeTrends(zero, config)[0].change, null);
});
test("content evidence uses real publication dates, rejects wrong platforms, preserves missing metrics", () => {
  const rows = parseContent([{ title: "in range", url: "https://www.youtube.com/watch?v=a", date: "2026-06-29", viewCount: 123, text: "video <b>description</b>" }, { url: "https://www.youtube.com/watch?v=b", date: "2026-05-01", viewCount: 9999 }, { url: "javascript:alert(1)", date: "2026-06-29" }, { url: "https://www.youtube.com/watch?v=c" }], "youtube", "2026-06-22", "2026-07-06");
  assert.equal(rows.length, 1); assert.equal(rows[0].views, 123); assert.equal(rows[0].likes, null);
  assert.equal(rows[0].description, "video description");
  const ig = parseContent([{ url: "https://www.instagram.com/reel/abc/", timestamp: "2026-01-01", likesCount: 12 }], "instagram", "2026-06-22", "2026-07-06");
  assert.equal(ig.length, 1); assert.equal(ig[0].views, null);
});

test("legacy results without regional rows remain loadable", () => {
  const r = parseTrendDataset([{ searchTerm: "compare", interestOverTime_timelineData: [point("2026-06-29", [10, 1])] }], config);
  const legacy = { ...r } as Record<string, unknown>;
  delete legacy.regions;
  delete legacy.regionLevel;
  const validated = validateResult(legacy, config);
  assert.deepEqual(validated.regions, []);
  assert.equal(validated.regionLevel, "");
});
