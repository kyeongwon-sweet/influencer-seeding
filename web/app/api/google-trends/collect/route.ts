import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startActorRunWithId } from "@/lib/apify";
import { GOOGLE_TREND_KEYWORDS } from "@/lib/google-trend-groups";

// 구글 웹 검색 트렌드를 볼 키워드 (Google Trends 웹 검색, 상대값 0~100).
// 그룹 정의(합산·라벨)는 lib/google-trend-groups 한 곳에서 관리 — 여기선 평탄화된 수집 대상만 쓴다.
// 한 run=한 키워드(?kw=N)가 원칙이고, 전용 워크플로(google-search-trends.yml)가 kw=0..N을
// 순차 호출한다. 액터 내부에서도 키워드별 주거용 프록시 세션과 재시도를 사용한다.
const KEYWORDS = GOOGLE_TREND_KEYWORDS;

function getAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// 액터를 비동기로 시작하고, 완료되면 /api/google-trends/webhook 이 결과를 저장한다.
export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") { // fail-closed: CRON_SECRET 미설정 시에도 차단(무인증 오픈 방지)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.APIFY_API_TOKEN) {
    return NextResponse.json({ error: "APIFY_API_TOKEN not configured" }, { status: 500 });
  }

  const webhookUrl = `${getAppUrl()}/api/google-trends/webhook?token=${encodeURIComponent(process.env.WEBHOOK_SECRET ?? "")}`;

  const params = new URL(req.url).searchParams;
  // ?count → 실행 없이 키워드 개수만 반환. 워크플로가 소스(google-trend-groups)에서 직접 읽어
  // KEYWORD_COUNT 하드코딩 드리프트(키워드 추가 시 미수집)를 없앤다.
  if (params.get("count") !== null) {
    return NextResponse.json({ ok: true, keywordCount: KEYWORDS.length });
  }

  // ?kw=N → 해당 키워드 1개만 수집(키워드별 순차 실행용).
  // GitHub Actions가 kw=0 완료 → kw=1 순서로 호출해 실패 범위와 재시도 대상을 분리한다.
  const kwParam = params.get("kw");
  const idx = kwParam !== null ? Number(kwParam) : NaN;
  // ⚠️ kw가 범위를 벗어나면(개수 드리프트 등) '전체를 한 run에' 대신 안전 no-op으로 끝낸다.
  //    (전체 한 run은 Google 차단·1건만 산출 → 위험. 워크플로는 done=true를 보고 루프를 종료한다.)
  if (kwParam !== null && (!Number.isInteger(idx) || idx < 0 || idx >= KEYWORDS.length)) {
    return NextResponse.json({ ok: true, done: true, skipped: "out_of_range", keywordCount: KEYWORDS.length });
  }
  const keywords = Number.isInteger(idx) && idx >= 0 && idx < KEYWORDS.length ? [KEYWORDS[idx]] : KEYWORDS;

  const runId = await startActorRunWithId(
    "signalbench/google-trends-scraper",
    {
      searchTerms: keywords,
      timeRange: "today 3-m",
      geo: "KR",
      category: "0",
      includeInterestOverTime: true,
      includeInterestByRegion: false,
      includeRelatedQueries: false,
      includeRelatedTopics: false,
      language: "ko-KR",
      maxRetriesPerTerm: 5,
      proxyConfiguration: {
        useApifyProxy: true,
        apifyProxyGroups: ["RESIDENTIAL"],
      },
    },
    webhookUrl,
  );
  return NextResponse.json({ ok: true, started: true, runId, keywords });
}

// Vercel 크론은 GET으로 호출 → POST와 동일 처리 (body 미사용)
export const GET = POST;
