// 구글 웹 검색 트렌드 — "그룹 = 라인 1개(그룹 내 키워드 합산)" 정의.
// collect 라우트(수집할 키워드 목록)와 프론트(그룹별 합산·라벨)가 이 한 파일을 공유한다.
//
// ⚠️ Google Trends 값은 검색어별로 각자 0~100으로 정규화된 상대지수다. 한 그룹의
// 여러 키워드를 합산하면 정확한 절대 검색량이 아니라 '대략적 합성 추세'가 된다
// (추세 모양 비교엔 유효, 절대값 비교엔 부정확). 유튜브 검색량 합산과 동일한 성격.
export type GoogleTrendGroup = { key: string; label: string; keywords: string[] };

export const GOOGLE_TREND_GROUPS: GoogleTrendGroup[] = [
  {
    key: "brand",
    label: "구글 라라스윗, 라라스윗아이스크림 검색량",
    keywords: ["라라스윗", "라라스윗아이스크림"],
  },
  {
    key: "jjondeuk",
    label: "구글 멜론쫀득바,망고쫀득바,라라스윗쫀득바 검색량",
    keywords: [
      "멜론쫀득바",
      "망고쫀득바",
      "라라스윗쫀득바",
      "GS멜론쫀득바",
      "라라스윗멜론쫀득바",
      "노을멜론바",
      "라라스윗노을멜론바",
      "라라스윗노을멜론",
      "라라스윗망고쫀득바",
    ],
  },
];

// 수집 대상 키워드 평탄화(그룹 순서 유지, 중복 제거). collect 라우트가 ?kw=N 로 인덱싱한다.
export const GOOGLE_TREND_KEYWORDS: string[] = Array.from(
  new Set(GOOGLE_TREND_GROUPS.flatMap((g) => g.keywords))
);
