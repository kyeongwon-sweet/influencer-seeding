import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

const NAVER_API = "https://openapi.naver.com/v1/datalab/search";

// 네이버 Datalab 상대 비율(0~100) → 절대 검색량 변환 계수
// 기준: '라라스윗'+'라라스윗아이스크림' 합산이 100인 2024-04-05의 실제 검색량 = 1,326.173건
const ABSOLUTE_FACTOR = 1326.173 / 100; // ≈ 13.26173

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

  const naverRes = await fetch(NAVER_API, {
    method: "POST",
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID!,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startDate: fmtDate(startDate),
      endDate: fmtDate(endDate),
      timeUnit: "date",
      keywordGroups: [{ groupName: "검색어", keywords: kwList }],
    }),
  });

  if (!naverRes.ok) {
    const err = await naverRes.text();
    return NextResponse.json({ error: `네이버 API 오류: ${err}` }, { status: 502 });
  }

  const naverData = await naverRes.json();
  const dataPoints: { period: string; ratio: number }[] =
    naverData.results?.[0]?.data ?? [];

  // 전 7일: index 0-6 / 광고 당일: index 7 / 후 7일: index 8-14
  const beforeData = dataPoints.slice(0, 7);
  const afterData = dataPoints.slice(8, 15);

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
