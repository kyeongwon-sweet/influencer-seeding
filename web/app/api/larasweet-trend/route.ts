import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

// 기준점: 2026-05-31 라라스윗+라라스윗아이스크림 실제 검색량
// solo 쿼리에서 이 날의 ratio로 FACTOR를 역산 → 전 날짜 절대검색량 보정
const REF_DATE = "2026-05-31";
const REF_ACTUAL = 3748;

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  if (!startDate || !endDate) return NextResponse.json({ error: "startDate, endDate 필요" }, { status: 400 });

  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;
  if (!clientId || !clientSecret) return NextResponse.json({ data: [] });

  // 기준날짜(REF_DATE)가 쿼리 범위에 포함되도록 보정
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
        { groupName: "라라스윗", keywords: ["라라스윗", "라라스윗아이스크림"] },
      ],
    }),
  });

  if (!res.ok) return NextResponse.json({ data: [] });

  const json = await res.json();
  const raw: { period: string; ratio: number }[] = json.results?.[0]?.data ?? [];

  // REF_DATE의 ratio로 절대검색량 변환 계수 역산
  const refPoint = raw.find(d => d.period.slice(0, 10) === REF_DATE);
  const factor = refPoint && refPoint.ratio > 0 ? REF_ACTUAL / refPoint.ratio : null;

  const data = raw
    .filter(d => d.period.slice(0, 10) >= startDate && d.period.slice(0, 10) <= endDate)
    .map(d => ({
      date:  d.period.slice(0, 10),
      ratio: d.ratio,
      value: factor ? Math.round(d.ratio * factor) : null,
    }));

  return NextResponse.json({ data });
}
