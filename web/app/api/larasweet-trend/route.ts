import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

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

  const res = await fetch("https://openapi.naver.com/v1/datalab/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Naver-Client-Id": clientId,
      "X-Naver-Client-Secret": clientSecret,
    },
    body: JSON.stringify({
      startDate,
      endDate,
      timeUnit: "date",
      keywordGroups: [
        { groupName: "라라스윗", keywords: ["라라스윗", "라라스윗아이스크림"] },
      ],
    }),
  });

  if (!res.ok) return NextResponse.json({ data: [] });

  const json = await res.json();
  const raw: { period: string; ratio: number }[] = json.results?.[0]?.data ?? [];

  const data = raw.map(d => ({
    date: d.period.slice(0, 10),
    ratio: d.ratio,
  }));

  return NextResponse.json({ data });
}
