import { NextRequest, NextResponse } from "next/server";
import { startActorRun } from "@/lib/apify";

// 유튜브 검색 트렌드를 볼 키워드 (Google Trends gprop=youtube, 상대값 0~100)
const KEYWORDS = ["라라스윗", "라라스윗아이스크림"];

function getAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// Apify google-trends-scraper는 콜드 실행 시 수 분~10분 걸려 동기 대기가 불가 →
// 비동기로 시작하고, 완료되면 /api/youtube-trends/webhook 이 결과를 저장한다.
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.APIFY_API_TOKEN) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });
  }

  const webhookUrl = `${getAppUrl()}/api/youtube-trends/webhook?token=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}`;

  // 키워드별로 개별 실행 — 한 실행에 여러 URL을 넣으면 일부만 산출되는 경우가 있어 분리.
  // 각 실행 완료 시 webhook이 해당 키워드 데이터를 upsert.
  for (const kw of KEYWORDS) {
    const startUrls = [{
      url: `https://trends.google.com/trends/explore?date=today%203-m&geo=KR&gprop=youtube&q=${encodeURIComponent(kw)}`,
    }];
    await startActorRun("apify/google-trends-scraper", { startUrls, maxItems: 5 }, webhookUrl);
  }
  return NextResponse.json({ ok: true, started: KEYWORDS.length });
}
