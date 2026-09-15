import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { validateConfig, validDate, dateOffset } from "@/lib/google-search-tracker";
export async function POST(request: Request) {
  if (!(await auth()).userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const raw = await request.text(); if (raw.length > 16000) throw new Error("요청이 너무 큽니다.");
    const body = JSON.parse(raw), c = validateConfig(body.config);
    if (!Number.isInteger(body.group) || !c.groups[body.group] || !validDate(body.date) || body.date < c.start || body.date > c.end) throw new Error("조회할 이벤트를 확인하세요.");
    const clientId = process.env.NAVER_CLIENT_ID, clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("네이버 검색 API 키가 설정되지 않았습니다.");
    const from = dateOffset(body.date, -c.windowDays), to = dateOffset(body.date, c.windowDays);
    const results = await Promise.all(["news", "blog"].map(async type => {
      const query = new URLSearchParams({ query: c.groups[body.group].terms[0], display: "100", sort: "date" });
      const response = await fetch(`https://openapi.naver.com/v1/search/${type}.json?${query}`, { headers: { "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret }, signal: AbortSignal.timeout(15000), cache: "no-store" });
      if (!response.ok) throw new Error(`네이버 ${type} 조회 실패 (${response.status})`);
      const data = await response.json();
      return (data.items ?? []).map((p: Record<string, string>) => {
        const rawDate = p.postdate || p.pubDate;
        const date = /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}` : Number.isFinite(Date.parse(rawDate)) ? new Date(rawDate).toISOString().slice(0, 10) : null;
        const clean = (s: string) => String(s || "").replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").slice(0, 1500);
        return { title: clean(p.title), description: clean(p.description), url: p.originallink || p.link, author: clean(p.bloggername || type), date, views: null, likes: null };
      }).filter((p: { date: string | null; url: string }) => p.date && p.date >= from && p.date <= to && /^https?:\/\//.test(p.url)).slice(0, 10);
    }));
    return NextResponse.json({ content: results.flat() });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "조회 실패" }, { status: 400 }); }
}
