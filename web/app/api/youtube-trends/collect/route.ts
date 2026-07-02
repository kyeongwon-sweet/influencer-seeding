import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
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
  if (checkCronAuth(req) !== "ok") { // fail-closed: CRON_SECRET 미설정 시에도 차단(무인증 오픈 방지)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.APIFY_API_TOKEN) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });
  }

  const webhookUrl = `${getAppUrl()}/api/youtube-trends/webhook?token=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}`;

  // ?kw=N → 해당 키워드 1개만 수집(키워드별 순차 실행용). 없으면 전체.
  // 한 run에 여러 키워드를 넣으면 1개만 산출되고, 동시에 별도 run을 띄우면 Google이 차단함 →
  // GitHub Actions가 kw=0 → 대기 → kw=1 로 시간차 호출(순차)해 두 키워드 모두 안정 수집.
  const kwParam = new URL(req.url).searchParams.get("kw");
  const idx = kwParam !== null ? Number(kwParam) : NaN;
  const keywords = Number.isInteger(idx) && KEYWORDS[idx] ? [KEYWORDS[idx]] : KEYWORDS;

  const startUrls = keywords.map((kw) => ({
    url: `https://trends.google.com/trends/explore?date=today%203-m&geo=KR&gprop=youtube&q=${encodeURIComponent(kw)}`,
  }));
  await startActorRun("apify/google-trends-scraper", { startUrls, maxItems: 50 }, webhookUrl);
  return NextResponse.json({ ok: true, started: true, keywords });
}

// Vercel 크론은 GET으로 호출 → POST와 동일 처리 (body 미사용)
export const GET = POST;
