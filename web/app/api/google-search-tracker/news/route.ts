import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { validateConfig, validDate, dateOffset } from "@/lib/google-search-tracker";
import { googleNewsUrl, parseGoogleNews } from "@/lib/google-tracker-news";
export async function POST(request: Request) {
  if (!(await auth()).userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const raw = await request.text(); if (raw.length > 16000) throw new Error("요청이 너무 큽니다.");
    const body = JSON.parse(raw), c = validateConfig(body.config);
    if (!Number.isInteger(body.group) || !c.groups[body.group] || !validDate(body.date) || body.date < c.start || body.date > c.end) throw new Error("조회할 이벤트를 확인하세요.");
    const from = dateOffset(body.date, -c.windowDays), to = dateOffset(body.date, c.windowDays);
    const response = await fetch(googleNewsUrl(c, body.group, from, to), { signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!response.ok) throw new Error(`Google 뉴스 조회 실패 (${response.status}). 검색 링크에서 직접 확인할 수 있습니다.`);
    return NextResponse.json({ content: parseGoogleNews(await response.text(), from, to) });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "조회 실패" }, { status: 400 }); }
}
