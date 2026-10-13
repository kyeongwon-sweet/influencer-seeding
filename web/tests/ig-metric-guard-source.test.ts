// 첫 측정 의심 가드 — 조회수 출처(필드)별 판정 계약 (2026-10-13 추가).
//
// 🚨 neighbor.mia(p/Dd_LfJwSelW, 무상시딩 영상)가 463→466→473→475→477→480 으로 매일 실제로
//    늘어나는 조회수를 8일째 버렸다. 좋아요가 숨김(-1)이라 댓글 비율 규칙(조회수 ≤ 댓글×20)만
//    남았는데 무상시딩 글은 댓글 이벤트로 조회수 대비 댓글이 많은 게 정상이다.
//    fromsensuous(1,099~1,166 / 좋아요 531)도 같은 가드의 오탐이었다(사람이 1,199 확인).
//    도입(2026-07-30) 이후 슬랙에 남은 발동은 이 두 글뿐이고 둘 다 진짜 값이었다.
// 백테스트: 실제 저장된 IG 자동 측정 21,221행 중 '조회수 ≤ 좋아요' 또는 '좋아요·댓글·합계와
// 정확히 같음'은 0행. 현행 '≤ 좋아요×3' 모양은 21행(정상 데이터도 걸린다).

import test from "node:test";
import assert from "node:assert/strict";

import { looksLikeEngagementCountAsViews, trustedPlaySourceOf } from "../lib/ig-metric-guard.ts";

const T = "videoPlayCount";

test("🚨 neighbor.mia: 신뢰 필드에서 온 진짜 조회수는 버리지 않는다(사고 재현)", () => {
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 480, likesCount: -1, commentsCount: 31, source: T }), false);
});

test("🚨 fromsensuous: 좋아요 대비 조회수가 낮아도 신뢰 필드면 통과", () => {
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 1166, likesCount: 531, commentsCount: 8, source: T }), false);
});

test("원래 막으려던 모양은 신뢰 필드여도 잡는다 — 숫자 자체가 참여 지표", () => {
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 531, likesCount: 531, commentsCount: 8, source: T }), true, "조회수 = 좋아요");
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 400, likesCount: 531, commentsCount: 8, source: T }), true, "조회수 < 좋아요");
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 31, likesCount: -1, commentsCount: 31, source: T }), true, "조회수 = 댓글");
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 539, likesCount: 531, commentsCount: 8, source: T }), true, "조회수 = 좋아요+댓글");
});

test("모호한 필드(/p/ 대체값)에서 온 값은 종전 비율 규칙을 유지한다", () => {
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 480, likesCount: -1, commentsCount: 31, source: "views" }), true);
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 1166, likesCount: 531, commentsCount: 8, source: "count" }), true);
});

test("출처를 모르면 종전처럼 보수적으로 판정한다 — 기존 호출부 호환", () => {
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 480, likesCount: -1, commentsCount: 31 }), true);
});

test("직전 조회수가 있으면 첫 측정이 아니므로 판정하지 않는다", () => {
  assert.equal(looksLikeEngagementCountAsViews({ playCount: 31, commentsCount: 31, previousPlay: 25, source: T }), false);
});

test("trustedPlaySourceOf 는 조회수 전용 필드만 출처로 인정한다", () => {
  assert.equal(trustedPlaySourceOf({ videoPlayCount: 480 }), "videoPlayCount");
  assert.equal(trustedPlaySourceOf({ videoViewCount: 12 }), "videoViewCount");
  assert.equal(trustedPlaySourceOf({ views: 480 }), null);
  assert.equal(trustedPlaySourceOf({ videoPlayCount: 0, videoViewCount: 0 }), null);
});

test("세 수집 경로가 출처를 실제로 넘긴다(소스 계약) — 한쪽만 빠지면 경로마다 판정이 갈린다", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const read = (p: string) => readFileSync(join(import.meta.dirname, p), "utf8");
  const webhook = read("../app/api/apify-webhook/route.ts");
  assert.match(webhook, /play_count_source: trustedPlaySourceOf\(/);
  assert.match(webhook, /source: \(s\.play_count_source/);
  const collectNow = read("../app/api/monitoring/collect-now/route.ts");
  assert.match(collectNow, /source: pickedPlay\.source/);
  assert.match(collectNow, /source: stats\.source,/);
  const py = read("../../scripts/run_monitoring.py");
  assert.match(py, /_TRUSTED_IG_PLAY_SOURCES = frozenset\(\{"videoPlayCount", "videoViewCount"\}\)/, "파이썬 정본과 신뢰 필드 목록이 같아야 한다");
  assert.match(py, /source=s\.get\("play_count_source"\)/, "일일 수집(파이썬)도 출처를 넘겨야 한다");
});
