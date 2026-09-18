/** Google Trends observations are relative interest, never absolute search counts. */
export type TrackerGroup = { id: string; label: string; terms: string[]; tags: string[] };
export const GOOGLE_TREND_CATEGORIES = [
  ["0", "전체 카테고리"], ["3", "예술·엔터테인먼트"], ["47", "자동차"], ["44", "뷰티·피트니스"], ["22", "도서·문학"], ["12", "비즈니스·산업"], ["5", "컴퓨터·전자제품"], ["7", "금융"], ["71", "음식·음료"], ["8", "게임"], ["45", "건강"], ["65", "취미·레저"], ["11", "주택·정원"], ["13", "인터넷·통신"], ["958", "직업·교육"], ["19", "법률·정부"], ["16", "뉴스"], ["299", "온라인 커뮤니티"], ["14", "사람·사회"], ["66", "반려동물"], ["29", "부동산"], ["533", "참고자료"], ["174", "과학"], ["18", "쇼핑"], ["20", "스포츠"], ["67", "여행"],
] as const;
export const categoryLabel = (id: string) => GOOGLE_TREND_CATEGORIES.find(([value]) => value === id)?.[1] ?? "전체 카테고리";
export type TrackerConfig = { groups: TrackerGroup[]; start: string; end: string; geo: string; category: string; multiplier: number; minIndex: number; gapDays: number; windowDays: number };
export type TrendPoint = { date: string; values: (number | null)[] };
export type TrackerRegion = { geoCode: string; geoName: string; values: (number | null)[] };
export type TrackerResult = { points: TrendPoint[]; regions: TrackerRegion[]; regionLevel: string; collectedAt: string; granularity: string; sourceUrl: string; warnings: string[] };
export type TrackerEvent = { id: string; group: number; date: string; start: string; end: string; peak: number | null; baseline: number | null; change: number | null; kind: string; manual?: boolean };
export type TrackerContent = { title: string; url: string; author: string; date: string | null; views: number | null; likes: number | null; description: string };
const DAY = 86400000;
export const dateOffset = (date: string, days: number) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function parseGroups(text: string): TrackerGroup[] {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!lines.length || lines.length > 5) throw new Error("상품 묶음은 1~5개를 입력하세요.");
  const labels = new Set<string>();
  return lines.map((line, i) => {
    const [definition, tagText = ""] = line.split("|");
    const split = definition.indexOf("=");
    const label = definition.slice(0, split).trim();
    const terms = [...new Set(definition.slice(split + 1).split(",").map(s => s.trim()).filter(Boolean))];
    if (split < 1 || !label || label.length > 60 || !terms.length || terms.length > 25 || terms.some(s => s.length > 80 || /[+|=]/.test(s))) throw new Error(`${i + 1}번째 줄을 상품명=검색어1,검색어2 형식으로 입력하세요. 검색어는 25개 이하입니다.`);
    if (labels.has(label)) throw new Error("상품명은 서로 다르게 입력하세요.");
    labels.add(label);
    const tags = [...new Set(tagText.split(",").map(s => s.trim().replace(/^#/, "").replace(/\s/g, "")).filter(Boolean))];
    if (tags.length > 3 || tags.some(s => s.length > 60)) throw new Error("인스타 태그는 상품당 3개 이하로 입력하세요.");
    return { id: `g${i}`, label, terms, tags };
  });
}
export function validateConfig(input: unknown): TrackerConfig {
  if (!input || typeof input !== "object") throw new Error("분석 설정이 필요합니다.");
  const c = input as TrackerConfig;
  if (!Array.isArray(c.groups) || c.groups.some(g => !g || typeof g.label !== "string" || !Array.isArray(g.terms) || g.terms.some(t => typeof t !== "string") || !Array.isArray(g.tags) || g.tags.some(t => typeof t !== "string"))) throw new Error("검색어 묶음을 확인하세요.");
  const groups = parseGroups(c.groups.map(g => `${g.label}=${g.terms.join(",")}|${g.tags.join(",")}`).join("\n"));
  if (!validDate(c.start) || !validDate(c.end) || c.start > c.end || c.end > new Date().toISOString().slice(0, 10) || Date.parse(c.end) - Date.parse(c.start) > 5 * 366 * DAY || c.start < "2004-02-01") throw new Error("분석 기간은 2004년 2월 이후, 오늘 이전의 최대 5년으로 설정하세요.");
  if (!["KR", "US", "JP", ""].includes(c.geo)) throw new Error("지원하지 않는 국가입니다.");
  const category = typeof c.category === "string" ? c.category : "0";
  if (!GOOGLE_TREND_CATEGORIES.some(([id]) => id === category)) throw new Error("지원하지 않는 검색 카테고리입니다.");
  for (const [key, min, max] of [["multiplier", 1.5, 5], ["minIndex", 1, 100], ["gapDays", 1, 21], ["windowDays", 1, 21]] as const) if (typeof c[key] !== "number" || !Number.isFinite(c[key]) || c[key] < min || c[key] > max) throw new Error("고급 분석 설정 범위를 확인하세요.");
  const config = { groups, start: c.start, end: c.end, geo: c.geo, category, multiplier: c.multiplier, minIndex: c.minIndex, gapDays: c.gapDays, windowDays: c.windowDays };
  if (new TextEncoder().encode(JSON.stringify(config)).length > 15000) throw new Error("분석 설정이 너무 큽니다. 검색어를 줄여주세요.");
  return config;
}
export function trendsUrl(c: TrackerConfig) {
  const params = new URLSearchParams({ date: `${dateOffset(c.start, -28)} ${c.end}`, geo: c.geo, q: c.groups.map(g => g.terms.join(" + ")).join(",") });
  if (c.category !== "0") params.set("cat", c.category);
  return `https://trends.google.com/trends/explore?${params}`;
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const indexValue = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
const KR_REGIONS: Record<string, string> = { "KR-11": "서울특별시", "KR-26": "부산광역시", "KR-27": "대구광역시", "KR-28": "인천광역시", "KR-29": "광주광역시", "KR-30": "대전광역시", "KR-31": "울산광역시", "KR-41": "경기도", "KR-42": "강원특별자치도", "KR-43": "충청북도", "KR-44": "충청남도", "KR-45": "전북특별자치도", "KR-46": "전라남도", "KR-47": "경상북도", "KR-48": "경상남도", "KR-49": "제주특별자치도", "KR-50": "세종특별자치시" };
export function parseTrendDataset(items: unknown[], c: TrackerConfig): TrackerResult {
  const dates = new Map<string, (number | null)[]>();
  const regionRows = new Map<string, TrackerRegion>();
  const found = new Set<number>();
  const covered = new Set<number>();
  let partial = 0;
  let regionLevel = "";
  for (const raw of items) {
    const item = record(raw);
    const timeline = item.interestOverTime_timelineData;
    if (!Array.isArray(timeline)) continue;
    const query = String(item.searchTerm ?? "").trim();
    const single = c.groups.findIndex(g => g.terms.join(" + ") === query || (g.terms.length === 1 && g.terms[0] === query));
    for (const rawPoint of timeline) {
      const p = record(rawPoint);
      const time = typeof p.time === "number" || typeof p.time === "string" ? Number(p.time) : NaN;
      if (!Number.isFinite(time) || time <= 0) continue;
      const date = new Date(time * 1000).toISOString().slice(0, 10);
      if (date < dateOffset(c.start, -28) || date > c.end) continue;
      const values = Array.isArray(p.value) ? p.value : [];
      const hasData = Array.isArray(p.hasData) ? p.hasData : [];
      const isPartial = p.isPartial === true || (Array.isArray(p.isPartial) && p.isPartial.some(Boolean));
      if (isPartial) { partial++; continue; }
      const row = dates.get(date) ?? c.groups.map(() => null);
      if (values.length === c.groups.length && (values.length > 1 || single === 0)) {
        values.forEach((value, i) => { covered.add(i); row[i] = hasData[i] === false ? null : indexValue(value); if (row[i] !== null) found.add(i); });
      } else if (single >= 0 && values.length === 1) {
        covered.add(single); row[single] = hasData[0] === false ? null : indexValue(values[0]); if (row[single] !== null) found.add(single);
      }
      dates.set(date, row);
    }
    const source = !c.geo && Array.isArray(item.interestBy) && item.interestBy.length ? item.interestBy
      : Array.isArray(item.interestBySubregion) && item.interestBySubregion.length ? item.interestBySubregion
      : Array.isArray(item.interestByCity) && item.interestByCity.length ? item.interestByCity
      : Array.isArray(item.interestBy) ? item.interestBy : [];
    if (Array.isArray(source) && source.length) {
      const level = source === item.interestBy ? "국가" : source === item.interestBySubregion ? (c.geo === "KR" ? "시·도" : "하위 지역") : "도시";
      if (!regionLevel || regionLevel === level) regionLevel = level;
      for (const rawRegion of source) {
        const region = record(rawRegion);
        const geoCode = textValue(region.geoCode, 80);
        const rawName = textValue(region.geoName, 120);
        if (!geoCode && !rawName) continue;
        const key = geoCode || rawName;
        const row = regionRows.get(key) ?? { geoCode, geoName: c.geo === "KR" && KR_REGIONS[geoCode] ? KR_REGIONS[geoCode] : rawName || geoCode, values: c.groups.map(() => null) };
        const values = Array.isArray(region.value) ? region.value : [];
        const hasData = Array.isArray(region.hasData) ? region.hasData : [];
        if (values.length === c.groups.length && (values.length > 1 || single === 0)) values.forEach((value, i) => { row.values[i] = hasData[i] === false ? null : indexValue(value); });
        else if (single >= 0 && values.length === 1) row.values[single] = hasData[0] === false ? null : indexValue(values[0]);
        regionRows.set(key, row);
      }
    }
  }
  const points = [...dates].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, values }));
  if (!points.some(p => p.date >= c.start && p.values.some(v => v !== null))) throw new Error("Google Trends가 유효한 데이터를 반환하지 않았습니다. 검색량이 적거나 수집이 제한됐을 수 있습니다. 검색어를 넓히거나 Google Trends에서 직접 확인하세요.");
  if (covered.size !== c.groups.length) throw new Error("일부 상품의 시계열이 누락됐습니다. 검색어 묶음을 줄여 다시 수집하세요.");
  const intervals = points.slice(1).map((p, i) => (Date.parse(p.date) - Date.parse(points[i].date)) / DAY).sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)] ?? 1;
  const regions = [...regionRows.values()].filter(row => row.values.some(value => value !== null)).slice(0, 500);
  return { points, regions, regionLevel: regions.length ? regionLevel : "", collectedAt: new Date().toISOString(), granularity: median >= 27 ? "월별" : median >= 6 ? "주별" : "일별", sourceUrl: trendsUrl(c), warnings: ["0은 검색이 없다는 뜻이 아니라 낮은 관심도 또는 부족한 표본일 수 있습니다.", ...(median >= 27 ? ["월별 데이터는 직전 28일 표본이 부족해 급등을 판정하지 못할 수 있습니다. 더 짧은 기간으로 조회하세요."] : []), ...c.groups.filter((_, i) => !found.has(i)).map(g => `${g.label}: 유효 표본이 없습니다. 검색어를 넓혀 확인하세요.`), ...(partial ? [`미완료 구간 ${partial}개를 분석에서 제외했습니다.`] : []), ...(!regions.length ? ["지역별 관심도 데이터가 반환되지 않았습니다. 검색량이 적거나 선택 지역에서 제공되지 않을 수 있습니다."] : [])] };
}
export function validateResult(input: unknown, c: TrackerConfig): TrackerResult {
  const r = record(input);
  if (!Array.isArray(r.points) || !r.points.length || r.points.length > 2000) throw new Error("시계열 결과를 확인하세요.");
  const points = r.points.map(raw => {
    const p = record(raw);
    if (!validDate(p.date) || p.date < dateOffset(c.start, -28) || p.date > c.end || !Array.isArray(p.values) || p.values.length !== c.groups.length || p.values.some(v => v !== null && indexValue(v) === null)) throw new Error("유효하지 않은 시계열입니다.");
    return { date: p.date, values: p.values as (number | null)[] };
  });
  if (points.some((p, i) => i > 0 && p.date <= points[i - 1].date)) throw new Error("시계열 날짜가 중복되거나 순서가 잘못됐습니다.");
  const regions = Array.isArray(r.regions) ? r.regions.slice(0, 500).map(raw => {
    const region = record(raw);
    if (!Array.isArray(region.values) || region.values.length !== c.groups.length || region.values.some(value => value !== null && indexValue(value) === null)) throw new Error("유효하지 않은 지역별 관심도입니다.");
    const geoCode = textValue(region.geoCode, 80), geoName = textValue(region.geoName, 120);
    if (!geoCode && !geoName) throw new Error("유효하지 않은 지역 이름입니다.");
    return { geoCode, geoName, values: region.values as (number | null)[] };
  }) : [];
  if (new Set(regions.map(region => region.geoCode || region.geoName)).size !== regions.length) throw new Error("지역별 관심도에 중복 지역이 있습니다.");
  return { points, regions, regionLevel: regions.length ? textValue(r.regionLevel, 30) : "", collectedAt: textValue(r.collectedAt, 60), granularity: textValue(r.granularity, 20), sourceUrl: trendsUrl(c), warnings: Array.isArray(r.warnings) ? r.warnings.map(w => textValue(w, 500)).slice(0, 12) : [] };
}
export function analyzeTrends(result: TrackerResult, c: TrackerConfig): TrackerEvent[] {
  const events: TrackerEvent[] = [];
  c.groups.forEach((_, group) => {
    const spikes: { point: TrendPoint; value: number; baseline: number }[] = [];
    result.points.forEach((point, i) => {
      const value = point.values[group];
      if (point.date < c.start || point.date > c.end || value === null || value === undefined || value < c.minIndex) return;
      const before = result.points.slice(0, i).filter(p => p.date >= dateOffset(point.date, -28)).map(p => p.values[group]).filter((v): v is number => typeof v === "number");
      if (before.length < 3) return;
      const baseline = before.reduce((a, b) => a + b, 0) / before.length;
      if (value >= baseline * c.multiplier && value > baseline) spikes.push({ point, value, baseline });
    });
    const clusters: typeof spikes[] = [];
    spikes.forEach(s => { const last = clusters.at(-1); if (last && Date.parse(s.point.date) - Date.parse(last.at(-1)!.point.date) <= c.gapDays * DAY) last.push(s); else clusters.push([s]); });
    clusters.forEach(cluster => {
      const peak = cluster.reduce((best, s) => s.value > best.value ? s : best);
      const start = cluster[0].point.date, end = cluster.at(-1)!.point.date;
      events.push({ id: `${group}:${peak.point.date}`, group, date: peak.point.date, start, end, peak: peak.value, baseline: peak.baseline, change: peak.baseline > 0 ? (peak.value / peak.baseline - 1) * 100 : null, kind: cluster.length >= 3 && Date.parse(end) - Date.parse(start) >= 7 * DAY ? "지속 상승" : "급등" });
    });
  });
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.group - b.group);
}
export function trendSummary(result: TrackerResult, c: TrackerConfig, group: number) {
  const points = result.points.filter(p => p.date >= c.start && p.date <= c.end && typeof p.values[group] === "number");
  const peak = points.reduce<TrendPoint | null>((best, p) => !best || p.values[group]! > best.values[group]! ? p : best, null);
  return { peak: peak?.values[group] ?? null, date: peak?.date ?? null, mean: points.length ? points.reduce((n, p) => n + p.values[group]!, 0) / points.length : null, count: points.length };
}
const textValue = (v: unknown, limit = 500) => typeof v === "string" ? v.slice(0, limit).replace(/<[^>]*>/g, "") : "";
const countValue = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
export function parseContent(items: unknown[], platform: "youtube" | "instagram", from: string, to: string): TrackerContent[] {
  return items.map(raw => {
    const p = record(raw);
    let date: string | null = null;
    for (const value of [p.date, p.uploadDate, p.publishedAt, p.timestamp]) {
      const parsed = typeof value === "number" ? new Date(value * 1000) : typeof value === "string" ? new Date(value) : null;
      if (parsed && Number.isFinite(parsed.getTime())) { date = parsed.toISOString().slice(0, 10); break; }
    }
    const url = textValue(p.url ?? p.videoUrl);
    const owner = record(p.channel);
    return { title: textValue(p.title ?? p.caption, 300), url, author: textValue(p.channelName ?? p.ownerUsername ?? owner.name), date, views: countValue(p.viewCount ?? p.videoPlayCount ?? p.videoViewCount), likes: countValue(p.likesCount ?? p.likes), description: textValue(p.description ?? p.text ?? p.caption, 1200) };
  }).filter(p => {
    try { const u = new URL(p.url); if (u.protocol !== "https:" || !((platform === "youtube" ? /(^|\.)youtube\.com$|^youtu\.be$/ : /(^|\.)instagram\.com$/).test(u.hostname))) return false; } catch { return false; }
    return platform === "instagram" || (p.date !== null && p.date >= from && p.date <= to);
  }).sort((a, b) => (b.views ?? b.likes ?? -1) - (a.views ?? a.likes ?? -1)).filter((p, i, arr) => arr.findIndex(other => other.url === p.url) === i).slice(0, 10);
}
