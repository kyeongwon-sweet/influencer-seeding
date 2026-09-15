import { XMLParser } from "fast-xml-parser";
import type { TrackerContent, TrackerConfig } from "./google-search-tracker";
export function googleNewsUrl(c: TrackerConfig, group: number, from: string, to: string) {
  const terms = c.groups[group].terms.map(t => `"${t.replace(/"/g, "")}"`).join(" OR ");
  const locale = c.geo === "JP" ? { hl: "ja", gl: "JP", ceid: "JP:ja" } : c.geo === "US" || c.geo === "" ? { hl: "en-US", gl: "US", ceid: "US:en" } : { hl: "ko", gl: "KR", ceid: "KR:ko" };
  const nextDay = new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10);
  return `https://news.google.com/rss/search?${new URLSearchParams({ q: `(${terms}) after:${from} before:${nextDay}`, ...locale })}`;
}
export function parseGoogleNews(xml: string, from: string, to: string): TrackerContent[] {
  if (xml.length > 1000000 || /<!DOCTYPE/i.test(xml)) throw new Error("뉴스 응답 형식이 올바르지 않습니다.");
  const data = new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(xml);
  if (!data.rss?.channel) throw new Error("뉴스 피드를 읽을 수 없습니다.");
  const raw = data.rss.channel.item;
  const items: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const clean = (s: unknown, limit = 1200) => typeof s === "string" ? s.replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/gi, " ").trim().slice(0, limit) : "";
  return items.slice(0, 100).map(p => {
    const date = typeof p.pubDate === "string" && Number.isFinite(Date.parse(p.pubDate)) ? new Date(p.pubDate).toISOString().slice(0, 10) : null;
    return { title: clean(p.title, 300), url: clean(p.link, 2000), author: clean(p.source, 150), date, description: clean(p.description), views: null, likes: null };
  }).filter(p => p.date && p.date >= from && p.date <= to && /^https:\/\/[a-z0-9.-]+\//i.test(p.url)).filter((p, i, rows) => rows.findIndex(other => other.url === p.url) === i).slice(0, 10);
}
