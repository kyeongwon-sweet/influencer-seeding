import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregatePbachi, isPbachiAd } from "../lib/meta-pbachi.ts";

test("P바치는 광고명·광고그룹명·캠페인명 어디에 있어도 바치케 광고(공백·대소문자 무시)", () => {
  assert.equal(isPbachiAd({ campaign_name: "[P바치] 전환" }), true);
  assert.equal(isPbachiAd({ adset_name: "p 바치_25-34" }), true);
  assert.equal(isPbachiAd({ ad_name: "영상A_P바치" }), true);
  assert.equal(isPbachiAd({ campaign_name: "[JD혼] 인지", adset_name: "P망", ad_name: "바치" }), false);
  assert.equal(isPbachiAd({}), false);
});

test("P바치 광고만 합산하고 광고 목적별로 나눈다(노출·광고비·ThruPlay·3초조회)", () => {
  const agg = aggregatePbachi([
    { campaign_name: "P바치 전환", objective: "OUTCOME_SALES", impressions: "60000", spend: "5000000.4" },
    { campaign_name: "P바치 전환", objective: "OUTCOME_SALES", impressions: 37539, spend: 3000000 },
    {
      ad_name: "P바치 영상", objective: "OUTCOME_AWARENESS", impressions: "90000", spend: "449431",
      video_thruplay_watched_actions: [{ action_type: "video_view", value: "24253" }],
      actions: [{ action_type: "video_view", value: "51000" }, { action_type: "link_click", value: "9" }],
    },
    { campaign_name: "JD혼 인지", objective: "OUTCOME_AWARENESS", impressions: "999999", spend: "1" },
  ]);
  assert.equal(agg.scanned, 4);
  assert.equal(agg.matched, 3);
  assert.deepEqual(agg.byObjective.OUTCOME_SALES, { ads: 2, impressions: 97539, spend: 8000000, thruplay: 0, videoViews: 0 });
  assert.deepEqual(agg.byObjective.OUTCOME_AWARENESS, { ads: 1, impressions: 90000, spend: 449431, thruplay: 24253, videoViews: 51000 });
  assert.equal(agg.total.impressions, 187539);
});

test("광고 목적이 없으면 UNKNOWN으로 묶는다", () => {
  const agg = aggregatePbachi([{ ad_name: "P바치", impressions: 5 }]);
  assert.equal(agg.byObjective.UNKNOWN.impressions, 5);
});

test("리포트 전환 = P바치 + 전환(구매) 목적 광고의 노출수만 — 인지 목적·다른 제품은 빠진다", () => {
  const agg = aggregatePbachi([
    { campaign_name: "[빙과_파인트] 26.10_바치케파인트990원_수동_전환", ad_name: "F_I_P바치_전환_A", objective: "OUTCOME_SALES", impressions: "60000", spend: "700000" },
    { campaign_name: "[빙과_파인트] 26.08_파인트990원_재집행", ad_name: "파인트990원_B", objective: "OUTCOME_SALES", impressions: "16511" },   // P바치 표시 없음 → 제외
    { ad_name: "P바치 인지영상", objective: "OUTCOME_AWARENESS", impressions: "90000", spend: "449431" },                                   // 인지 목적 → 제외
    { adset_name: "260929_P바치_990원", objective: "OUTCOME_SALES", impressions: 21038, spend: 308329 },
  ]);
  assert.deepEqual(agg.conversion, { impressions: 81038, spend: 1008329, ads: 2 });
});

test("그날 P바치 전환 광고가 없으면 전환은 0(광고 관리자 기준 집행 없음)", () => {
  assert.deepEqual(aggregatePbachi([{ ad_name: "JD혼", objective: "OUTCOME_SALES", impressions: 5 }]).conversion,
    { impressions: 0, spend: 0, ads: 0 });
});
