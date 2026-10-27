// 메타 광고 관리자(Graph Insights, level=ad)에서 바치케(P바치) 광고만 골라 그날 지표를 집계한다.
// 2026-10-27 사용자 기준: 바치케 광고 = 광고명·광고그룹명·캠페인명 중 하나에 'P바치'.
//   전환 조회수 = 메타 P바치 광고 '노출수' → `conversion`(P바치 & 전환 목적). 바치케 리포트·자동 보정이 이 값만 쓴다.
//   광고 목적(objective)별 합계는 진단용으로 함께 돌려준다.

export type MetaAdRow = {
  campaign_name?: string;
  adset_name?: string;
  ad_name?: string;
  objective?: string;
  spend?: string | number;
  impressions?: string | number;
  reach?: string | number;
  video_thruplay_watched_actions?: Array<{ action_type?: string; value?: string | number }>;
  actions?: Array<{ action_type?: string; value?: string | number }>;
};

export type MetricSum = { ads: number; impressions: number; spend: number; thruplay: number; videoViews: number };

const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return isFinite(n) ? n : 0;
};

/** 'P바치'가 광고명·광고그룹명·캠페인명 중 하나에 들어 있나(공백·대소문자 무시). */
export function isPbachiAd(r: MetaAdRow): boolean {
  return [r.campaign_name, r.adset_name, r.ad_name].some((s) =>
    String(s ?? "").replace(/\s+/g, "").toUpperCase().includes("P바치"),
  );
}

function sumOf(rows: MetaAdRow[]): MetricSum {
  const o: MetricSum = { ads: 0, impressions: 0, spend: 0, thruplay: 0, videoViews: 0 };
  for (const r of rows) {
    o.ads += 1;
    o.impressions += num(r.impressions);
    o.spend += num(r.spend);
    o.thruplay += (r.video_thruplay_watched_actions ?? []).reduce((a, x) => a + num(x.value), 0);
    // 3초 동영상 조회(actions의 video_view)
    o.videoViews += (r.actions ?? []).filter((x) => x.action_type === "video_view").reduce((a, x) => a + num(x.value), 0);
  }
  o.spend = Math.round(o.spend);
  return o;
}

// 전환(구매) 목적 — 바치케 리포트 '전환 조회수'에 넣는 광고. 같은 계정에 인지 목적 광고가 생겨도 섞이지 않게.
export const CONVERSION_OBJECTIVES = ["OUTCOME_SALES"];

/** P바치 광고만 골라 전체·광고 목적별 합계 + 리포트용 전환(= P바치 & 전환 목적 광고의 노출수). */
export function aggregatePbachi(rows: MetaAdRow[]) {
  const hit = rows.filter(isPbachiAd);
  const byObjective: Record<string, MetricSum> = {};
  for (const obj of Array.from(new Set(hit.map((r) => r.objective || "UNKNOWN")))) {
    byObjective[obj] = sumOf(hit.filter((r) => (r.objective || "UNKNOWN") === obj));
  }
  // 2026-10-27 사용자 결정: 전환 조회수 = 메타 'P바치' 광고 노출수('[빙과_파인트]' 전환 전체가 아님 — 시트보다 13~17% 적음).
  const conv = sumOf(hit.filter((r) => CONVERSION_OBJECTIVES.includes(r.objective || "")));
  return {
    total: sumOf(hit),
    byObjective,
    conversion: { impressions: conv.impressions, spend: conv.spend, ads: conv.ads },
    matched: hit.length,
    scanned: rows.length,
  };
}
