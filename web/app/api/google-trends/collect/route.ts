import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { startActorRunWithId } from "@/lib/apify";
import { GOOGLE_TREND_KEYWORDS } from "@/lib/google-trend-groups";

// 구글 웹 검색 트렌드를 볼 키워드 (Google Trends 웹 검색, gprop 미지정, 상대값 0~100).
// 그룹 정의(합산·라벨)는 lib/google-trend-groups 한 곳에서 관리 — 여기선 평탄화된 수집 대상만 쓴다.
// ⚠️ 액터는 키워드당 구글 트렌드 페이지를 직접 열어(1개당 수 분) 한 run에 1건만 안정적으로 산출한다.
// 그래서 한 run=한 키워드(?kw=N)가 원칙이고, 전용 워크플로(google-search-trends.yml)가 kw=0..N을
// 시간차로 순차 호출한다(동시 실행 시 Google 차단). geo 입력 enum이 KR에서 깨져 있어 startUrls로 geo=KR 지정.
const KEYWORDS = GOOGLE_TREND_KEYWORDS;

function getAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

// Apify google-trends-scraper는 콜드 실행 시 수 분~10분 걸려 동기 대기가 불가 →
// 비동기로 시작하고, 완료되면 /api/google-trends/webhook 이 결과를 저장한다.
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
  // 한 run에 여러 키워드를 넣으면 1개만 산출되고, 동시에 별도 run을 띄우면 Google이 차단함 →
  // GitHub Actions가 kw=0 → 대기 → kw=1 로 시간차 호출(순차)해 두 키워드 모두 안정 수집.
  const kwParam = params.get("kw");
  const idx = kwParam !== null ? Number(kwParam) : NaN;
  // ⚠️ kw가 범위를 벗어나면(개수 드리프트 등) '전체를 한 run에' 대신 안전 no-op으로 끝낸다.
  //    (전체 한 run은 Google 차단·1건만 산출 → 위험. 워크플로는 done=true를 보고 루프를 종료한다.)
  if (kwParam !== null && (!Number.isInteger(idx) || idx < 0 || idx >= KEYWORDS.length)) {
    return NextResponse.json({ ok: true, done: true, skipped: "out_of_range", keywordCount: KEYWORDS.length });
  }
  const keywords = Number.isInteger(idx) && idx >= 0 && idx < KEYWORDS.length ? [KEYWORDS[idx]] : KEYWORDS;

  // gprop 미지정 = 웹 검색(유튜브 트렌드와의 유일한 차이). 나머지는 동일.
  const startUrls = keywords.map((kw) => ({
    url: `https://trends.google.com/trends/explore?date=today%203-m&geo=KR&q=${encodeURIComponent(kw)}`,
  }));
  const runId = await startActorRunWithId(
    "apify/google-trends-scraper",
    {
      startUrls,
      maxItems: 50,
      maxConcurrency: 1,
      maxRequestRetries: 2,
      pageLoadTimeoutSecs: 120,
      skipDebugScreen: true,
    },
    webhookUrl,
  );
  return NextResponse.json({ ok: true, started: true, runId, keywords });
}

// Vercel 크론은 GET으로 호출 → POST와 동일 처리 (body 미사용)
export const GET = POST;
