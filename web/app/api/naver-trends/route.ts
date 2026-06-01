import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

// 네이버 Datalab 상대비율 → 절대 검색량 변환 계수 (keyword-impact와 동일)
// 공식: 절대검색량 = 상대비율 × LARASWEET_BASE
// (예: 5/31 상대비율 2.82637 × 1326.173 = 3748건)
const LARASWEET_BASE = 1326.173;

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
    startDate: string; // YYYY-MM-DD
    endDate: string;   // YYYY-MM-DD
  };

  const body = {
    startDate,
    endDate,
    timeUnit: "date",
    keywordGroups: [
      { groupName: keyword, keywords: [keyword] },
      // keyword-impact와 동일하게 두 키워드 합산 → 1326.173건 기준
      { groupName: "라라스윗기준", keywords: ["라라스윗", "라라스윗아이스크림"] },
    ],
  };

  const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    body: JSON.stringify(body),
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

  const dates = kwResult.data.map((d, i) => ({
    date: d.period.slice(0, 10),
    keywordAbsolute: Math.round(d.ratio * LARASWEET_BASE),
    larasweetAbsolute: Math.round((lsResult?.data[i]?.ratio ?? 0) * LARASWEET_BASE),
  }));

  return NextResponse.json({ dates });
}
