import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { validateConfig } from "@/lib/google-search-tracker";
import { buildAgeDistribution, NAVER_AGE_BANDS, sumNaverRatios } from "@/lib/google-tracker-age";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const raw = await request.text();
    if (raw.length > 20000) throw new Error("연령 분포 요청이 너무 큽니다.");
    const body = JSON.parse(raw);
    const config = validateConfig(body.config);
    const group = body.group;
    if (!Number.isInteger(group) || group < 0 || group >= config.groups.length) throw new Error("연령 분포를 조회할 상품을 확인하세요.");
    if (config.end < "2016-01-01") throw new Error("네이버 DataLab 연령 분포는 2016년 이후 기간만 조회할 수 있습니다.");
    const clientId = process.env.NAVER_CLIENT_ID;
    const clientSecret = process.env.NAVER_CLIENT_SECRET;
    if (!clientId || !clientSecret) return NextResponse.json({ error: "네이버 DataLab 연결 정보가 설정되지 않았습니다." }, { status: 503 });
    const selected = config.groups[group];
    const start = config.start < "2016-01-01" ? "2016-01-01" : config.start;
    const spanDays = Math.floor((Date.parse(config.end) - Date.parse(start)) / 86400000) + 1;
    const timeUnit = spanDays > 366 ? "month" : "date";
    const query = async (age?: string) => {
      const response = await fetch("https://openapi.naver.com/v1/datalab/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Naver-Client-Id": clientId, "X-Naver-Client-Secret": clientSecret },
        body: JSON.stringify({ startDate: start, endDate: config.end, timeUnit, keywordGroups: [{ groupName: selected.label, keywords: selected.terms }], ...(age ? { ages: [age] } : {}) }),
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "네이버 DataLab 연결 인증을 확인하세요." : `네이버 DataLab 조회에 실패했습니다. (${response.status})`);
      return sumNaverRatios(await response.json());
    };
    const total = await query();
    const ageTotals: number[] = [];
    for (let index = 0; index < NAVER_AGE_BANDS.length; index += 4) {
      ageTotals.push(...await Promise.all(NAVER_AGE_BANDS.slice(index, index + 4).map(age => query(age.code))));
    }
    const distribution = buildAgeDistribution({ groupId: selected.id, label: selected.label, start, end: config.end, granularity: timeUnit === "date" ? "일별" : "월별", total, ageTotals, collectedAt: new Date().toISOString() });
    if (start !== config.start) distribution.warning = [distribution.warning, "2016년 이전 구간은 네이버 DataLab 제공 범위에서 제외했습니다."].filter(Boolean).join(" ");
    return NextResponse.json({ distribution }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "연령 분포 조회에 실패했습니다." }, { status: 400 });
  }
}
