export const runtime = 'nodejs';

const MODULE = "meta-ads";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const dateFrom = searchParams.get("date_from");
    const dateTo = searchParams.get("date_to");

    // 1. 파라미터 검증
    if (!dateFrom || !dateTo) {
      console.error(`[${MODULE}] ❌ 필수 파라미터 누락`, {
        dateFrom: dateFrom ?? "undefined",
        dateTo: dateTo ?? "undefined",
      });
      return Response.json(
        { error: "date_from과 date_to는 필수입니다" },
        { status: 400 }
      );
    }

    console.log(`[${MODULE}] 📊 광고비 데이터 조회 시작`, {
      dateFrom,
      dateTo,
    });

    // 2. 환경변수 검증
    const accessToken = process.env.META_BUSINESS_ACCESS_TOKEN;
    const accountId = process.env.META_BUSINESS_ACCOUNT_ID;

    if (!accessToken || !accountId) {
      console.error(`[${MODULE}] ❌ 환경변수 미설정`, {
        hasToken: !!accessToken,
        hasAccountId: !!accountId,
      });
      return Response.json(
        {
          error:
            "META_BUSINESS_ACCESS_TOKEN 또는 META_BUSINESS_ACCOUNT_ID 환경변수가 설정되지 않았습니다",
        },
        { status: 500 }
      );
    }

    // Meta Ads Insights API 요청 구성
    // ⚠️ CRITICAL: time_increment=1 필수!
    //   - 없으면: 기간 전체의 누적 광고비 1개 항목만 반환 → 그래프 안 보임
    //   - 있으면: 일 단위 광고비 데이터 배열 반환 → 그래프 표시
    // 참고: https://developers.facebook.com/docs/marketing-api/insights
    const url = new URL(`https://graph.facebook.com/v18.0/act_${accountId}/insights`);
    url.searchParams.append('fields', 'spend,date_start');
    url.searchParams.append('since', dateFrom);
    url.searchParams.append('until', dateTo);
    url.searchParams.append('time_increment', '1');  // ← 없으면 버그 발생!
    url.searchParams.append('access_token', accessToken);

    // 3. API 요청
    const urlStr = url.toString().replace(accessToken, "***");
    console.log(`[${MODULE}] 🔗 API 요청`, { url: urlStr });

    const response = await fetch(url.toString());
    const data = await response.json();

    // 4. 응답 상태 검증
    if (!response.ok) {
      console.error(`[${MODULE}] ❌ API 응답 오류`, {
        status: response.status,
        error: data.error?.message || data.error || "Unknown error",
      });
      return Response.json(
        { error: "Meta API 오류", details: data.error },
        { status: response.status }
      );
    }

    // 5. 응답 구조 검증
    if (!data.data || !Array.isArray(data.data)) {
      console.warn(`[${MODULE}] ⚠️ 응답 구조 이상`, {
        hasData: !!data.data,
        isArray: Array.isArray(data.data),
        dataType: typeof data.data,
      });
      return Response.json([]);
    }

    console.log(`[${MODULE}] ✅ 응답 수신`, {
      itemCount: data.data.length,
      firstItem: data.data[0],
    });

    // 6. 데이터 필터링 및 정렬
    const sorted = data.data
      .filter((item) => item.date_start && item.spend)
      .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

    if (sorted.length === 0) {
      console.warn(`[${MODULE}] ⚠️ 필터링 후 데이터 없음`, {
        originalCount: data.data.length,
        filteredCount: sorted.length,
      });
      return Response.json([]);
    }

    console.log(`[${MODULE}] 📈 필터링 완료`, {
      originalCount: data.data.length,
      filteredCount: sorted.length,
    });

    // 7. 누적값 계산 및 반환
    let cumulative = 0;
    const result = sorted.map((item) => {
      const spend = parseFloat(item.spend) || 0;
      cumulative += spend;
      return {
        date: item.date_start.split("T")[0], // YYYY-MM-DD 형식
        total_cost: Math.round(cumulative * 100) / 100,
      };
    });

    console.log(`[${MODULE}] ✨ 데이터 반환 완료`, {
      resultCount: result.length,
      dateRange:
        result.length > 0
          ? `${result[0].date} ~ ${result[result.length - 1].date}`
          : "N/A",
      totalSpend:
        result.length > 0 ? result[result.length - 1].total_cost : 0,
    });

    return Response.json(result);

  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Unknown error";
    console.error(`[${MODULE}] 💥 예상치 못한 오류`, {
      error: errorMessage,
      stack: err instanceof Error ? err.stack : undefined,
    });
    return Response.json(
      { error: "API 오류", message: errorMessage },
      { status: 500 }
    );
  }
}
