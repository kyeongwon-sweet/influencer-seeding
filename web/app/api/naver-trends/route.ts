import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

// 기준점: 2026-05-31 라라스윗+라라스윗아이스크림 실제 검색량 3748
// FACTOR = 3748 / lsRatio_5_31 (해당 쿼리에서 실제 반환된 5/31 ratio로 역산)
// kwAbsolute = kwRatio × FACTOR
// lsAbsolute = lsRatio × FACTOR
const REF_DATE = "2026-05-31";
const REF_LS_ACTUAL = 3748;
const FALLBACK_BASE = 1326.173; // REF_DATE가 쿼리 범위 밖일 때 fallback

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다." },
      { status: 503 }
    );
  }

  const { keyword, startDate, endDate } = await req.json() as {
    keyword: string;
    startDate: string;
    endDate: string;
  };

  // REF_DATE가 쿼리 범위에 포함되도록 보정
  const qStart = startDate < REF_DATE ? startDate : REF_DATE;
  const qEnd   = endDate   > REF_DATE ? endDate   : REF_DATE;

  const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    body: JSON.stringify({
      startDate: qStart,
      endDate:   qEnd,
      timeUnit: "date",
      keywordGroups: [
        { groupName: keyword, keywords: [keyword] },
        { groupName: "라라스윗기준", keywords: ["라라스윗", "라라스윗아이스크림"] },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Naver API 오류: ${res.status} ${text}` }, { status: 502 });
  }

  const data = await res.json() as {
    results: { title: string; data: { period: string; ratio: number }[] }[];
  };

  const kwResult = data.results.find(r => r.title === keyword);
  const lsResult = data.results.find(r => r.title === "라라스윗기준");

  if (!kwResult) {
    return NextResponse.json({ error: "키워드 데이터를 받지 못했습니다." }, { status: 502 });
  }

  // 해당 쿼리의 lsRatio_5_31로 FACTOR 역산
  const lsRefPoint = lsResult?.data.find(d => d.period.slice(0, 10) === REF_DATE);
  const factor = lsRefPoint && lsRefPoint.ratio > 0
    ? REF_LS_ACTUAL / lsRefPoint.ratio
    : FALLBACK_BASE;

  const dates = kwResult.data
    .filter(d => d.period.slice(0, 10) >= startDate && d.period.slice(0, 10) <= endDate)
    .map((d) => {
      const lsRatio = lsResult?.data.find(s => s.period === d.period)?.ratio ?? 0;
      return {
        date: d.period.slice(0, 10),
        keywordAbsolute: Math.round(d.ratio * factor),
        larasweetAbsolute: Math.round(lsRatio * factor),
      };
    });

  return NextResponse.json({ dates });
}
