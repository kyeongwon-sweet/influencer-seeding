import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

const NAVER_API = "https://openapi.naver.com/v1/datalab/search";

// 네이버 Datalab 상대 비율 → 절대 검색량 변환 계수
// 기준: '라라스윗'+'라라스윗아이스크림' 기준 상수 1326.173
// (예: 5/31 상대비율 2.82637 × 1326.173 = 3748건)
const ABSOLUTE_FACTOR = 1326.173;

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function avg(arr: { ratio: number }[]) {
  if (!arr.length) return 0;
  return arr.reduce((s, d) => s + d.ratio, 0) / arr.length;
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { metricsId, keywords, adDate } = await req.json();

  if (!metricsId || !keywords || !adDate) {
    return NextResponse.json({ error: "metricsId, keywords, adDate 필수" }, { status: 400 });
  }

  const kwList = (keywords as string)
    .split(",")
    .map((k: string) => k.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (!kwList.length) {
    return NextResponse.json({ error: "유효한 검색어가 없습니다" }, { status: 400 });
  }

  const ad = new Date(adDate);
  const startDate = addDays(ad, -7);
  const endDate = addDays(ad, 7);

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다." }, { status: 503 });
  }

  const naverRes = await fetch(NAVER_API, {
    method: "POST",
    headers: {
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: fmtDate(startDate),
      endDate: fmtDate(endDate),
      timeUnit: "date",
      // 라라스윗 기준 그룹을 함께 조회해 검색량 스케일 앵커링
      // → 두 그룹이 동일한 0~100 척도 위에 정규화됨
      // → 라라스윗이 100점(=1,326.173건)에 해당하면 다른 키워드도 그 비율로 환산 가능
      keywordGroups: [
        { groupName: "검색어", keywords: kwList },
        { groupName: "라라스윗기준", keywords: ["라라스윗", "라라스윗아이스크림"] },
      ],
    }),
  });

  if (!naverRes.ok) {
    const err = await naverRes.text();
    return NextResponse.json({ error: `네이버 API 오류: ${err}` }, { status: 502 });
  }

  const naverData = await naverRes.json();
  // results[0] = 사용자 지정 검색어 그룹
  const dataPoints: { period: string; ratio: number }[] =
    naverData.results?.[0]?.data ?? [];

  // 날짜 문자열 비교로 before/after 분리 — 고정 인덱스는 Naver 누락일 발생 시 어긋남
  const adDateStr = fmtDate(ad);
  const beforeData = dataPoints.filter(d => d.period.slice(0, 10) < adDateStr);
  const afterData  = dataPoints.filter(d => d.period.slice(0, 10) > adDateStr);

  const beforeAvg = avg(beforeData);
  const afterAvg = avg(afterData);
  const impactPct =
    beforeAvg > 0 ? Math.round(((afterAvg - beforeAvg) / beforeAvg) * 1000) / 10 : null;

  const supabase = getServerSupabase();
  const kwBefore = Math.round(beforeAvg * ABSOLUTE_FACTOR * 10) / 10;
  const kwAfter = Math.round(afterAvg * ABSOLUTE_FACTOR * 10) / 10;

  const { error: dbErr } = await supabase
    .from("screening_metrics")
    .update({
      kw_keywords: kwList.join(", "),
      kw_ad_date: adDate,
      kw_impact: impactPct,
      kw_before: kwBefore,
      kw_after: kwAfter,
    })
    .eq("id", metricsId);

  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 });

  return NextResponse.json({
    kw_keywords: kwList.join(", "),
    kw_ad_date: adDate,
    kw_impact: impactPct,
    kw_before: kwBefore,
    kw_after: kwAfter,
  });
}
