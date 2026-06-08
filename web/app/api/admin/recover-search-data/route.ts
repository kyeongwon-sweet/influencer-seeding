import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 관리자 전용: 누락된 검색량 데이터 복구
 * POST /api/admin/recover-search-data
 * Authorization: Bearer <CRON_SECRET>
 */
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    const secret = process.env.CRON_SECRET;

    if (!secret || authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const naverId = process.env.NAVER_CLIENT_ID;
    const naverSecret = process.env.NAVER_CLIENT_SECRET;

    if (!naverId || !naverSecret) {
      return NextResponse.json(
        { error: "Naver API credentials not configured" },
        { status: 500 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // 복구할 날짜와 키워드
    const recoveryDates = ["2026-06-06", "2026-06-07"];
    const keywords = ["라라스윗", "라라스윗 아이스크림"];

    console.log("[LOG] 검색량 데이터 복구 시작");

    // Naver Trends API 호출
    const allData: any[] = [];

    for (const keyword of keywords) {
      console.log(`[LOG] 키워드: ${keyword}`);

      const response = await fetch("https://openapi.naver.com/v1/datalab/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Naver-Client-Id": naverId,
          "X-Naver-Client-Secret": naverSecret,
        },
        body: JSON.stringify({
          startDate: "2026-06-01",
          endDate: "2026-06-07",
          timeUnit: "date",
          keywordGroups: [
            { groupName: keyword, keywords: [keyword] },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Naver API failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.results || data.results.length === 0) {
        console.warn(`[WARN] No results for ${keyword}`);
        continue;
      }

      const result = data.results[0];
      const refItem = result.data.find((item: any) => item.period === "2026-05-31");

      if (!refItem || refItem.ratio === 0) {
        console.error("[ERROR] Reference date (2026-05-31) not found");
        continue;
      }

      const factor = 3748 / refItem.ratio; // REF_LS_ACTUAL / REF_RATIO

      // 복구할 날짜의 데이터만 추출
      for (const date of recoveryDates) {
        const item = result.data.find((d: any) => d.period === date);

        if (item && item.ratio > 0) {
          const absoluteVolume = item.ratio * factor;

          allData.push({
            date: date,
            keyword: keyword,
            search_volume: Math.round(absoluteVolume),
            measured_at: new Date().toISOString(),
          });

          console.log(`  ✅ ${date} ${keyword}: ${Math.round(absoluteVolume)}`);
        }
      }
    }

    if (allData.length === 0) {
      return NextResponse.json({
        success: false,
        message: "No data to recover",
      });
    }

    console.log(`[LOG] ${allData.length}건의 데이터 저장 중...`);

    // 기존 데이터 삭제
    for (const date of recoveryDates) {
      await supabase
        .from("search_keywords")
        .delete()
        .eq("date", date);
    }

    // 새 데이터 삽입
    const { error: insertError } = await supabase
      .from("search_keywords")
      .insert(allData);

    if (insertError) {
      throw new Error(`Supabase insert failed: ${insertError.message}`);
    }

    console.log(`[SUCCESS] 데이터 복구 완료: ${allData.length}건`);

    return NextResponse.json({
      success: true,
      message: "Search data recovered",
      recovered: allData.length,
      dates: recoveryDates,
      keywords: keywords,
      data: allData,
    });
  } catch (error) {
    console.error("[ERROR] Recovery failed:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
