import { parseContent, parseTrendDataset, trendsUrl, dateOffset, type TrackerConfig } from "./google-search-tracker";
import { signRun, type TrackerRun } from "./google-tracker-receipt";
async function apify(path: string, init?: RequestInit) {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN이 설정되지 않았습니다.");
  const response = await fetch(`https://api.apify.com/v2${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`수집 서비스 요청에 실패했습니다 (${response.status}). 잠시 후 다시 시도하세요.`);
  return response.json();
}
const actors = { trends: "apify~google-trends-scraper", youtube: "streamers~youtube-scraper", instagram: "apify~instagram-hashtag-scraper" };
export async function startTrackerRun(userId: string, kind: TrackerRun["kind"], config: TrackerConfig, group: number, date: string) {
  const actor = actors[kind];
  // One run per actor at a time; this also avoids overlapping the existing Trends cron.
  const active = await apify(`/acts/${actor}/runs?limit=5&desc=true`);
  if (active.data?.items?.some((r: { status: string }) => ["READY", "RUNNING"].includes(r.status))) throw new Error("같은 종류의 수집이 진행 중입니다. 완료 후 다시 시도하세요.");
  const g = config.groups[group];
  const input = kind === "trends" ? {
    startUrls: [{ url: trendsUrl(config) }], isMultiple: true, maxItems: config.groups.length,
    maxConcurrency: 1, maxRequestRetries: 1, pageLoadTimeoutSecs: 120, skipDebugScreen: true,
    ...(config.category !== "0" ? { category: config.category } : {}),
  } : kind === "youtube" ? {
    searchQueries: [g.terms[0]], maxResults: 30, maxResultsShorts: 10, sortingOrder: "views",
  } : { hashtags: g.tags.length ? g.tags : [g.terms[0].replace(/\s/g, "")], resultsType: "reels", resultsLimit: 15, keywordSearch: false };
  const started = await apify(`/acts/${actor}/runs?timeout=600&maxTotalChargeUsd=${kind === "trends" ? 1 : 2}`, { method: "POST", body: JSON.stringify(input) });
  const runId = started.data?.id;
  if (typeof runId !== "string") throw new Error("수집 실행 ID가 반환되지 않았습니다.");
  return signRun({ userId, runId, kind, config, group, date, expires: Date.now() + 24 * 3600000 });
}
export async function pollTrackerRun(run: TrackerRun) {
  const response = await apify(`/actor-runs/${encodeURIComponent(run.runId)}`);
  const data = response.data;
  if (["READY", "RUNNING", "TIMING-OUT", "ABORTING"].includes(data.status)) return { status: "running" as const };
  if (data.status !== "SUCCEEDED") throw new Error(`수집이 완료되지 않았습니다 (${data.status}). Google Trends 직접 확인 링크를 이용하거나 다시 시도하세요.`);
  const items = await apify(`/datasets/${encodeURIComponent(data.defaultDatasetId)}/items?clean=true&limit=500`);
  if (!Array.isArray(items)) throw new Error("수집 응답 형식이 올바르지 않습니다.");
  if (run.kind === "trends") return { status: "done" as const, result: parseTrendDataset(items, run.config) };
  return { status: "done" as const, content: parseContent(items, run.kind, dateOffset(run.date, -run.config.windowDays), dateOffset(run.date, run.config.windowDays)) };
}
