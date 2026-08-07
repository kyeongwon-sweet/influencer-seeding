import { test } from "node:test";
import assert from "node:assert/strict";
import { isNonAdAsset, stripDecorativePrefix, NON_AD_PRODUCT_NAME } from "../lib/non-ad-asset.ts";

// 이 규칙은 `scripts/audit_invalid_creator_fields.py`와 **같아야** 한다.
// 한쪽만 고치면 "감사는 정상인데 대시보드는 이상"으로 갈라진다(경로별 판정 드리프트).
// 파이썬 쪽 동일 케이스: scripts/test_audit_invalid_creator_fields.py

const AD_ASSET = "[26.07]F_V_JD멜_바이럴_쫀득바출시_바이럴형_렉카형_main.렉카_끝없이.X_2P_이재원_260711_빙과_최재헌";

test("비광고성 미러링 소재를 잡는다", () => {
  assert.equal(isNonAdAsset("비광고성_외부영상_미러링_이나연_슈퍼카"), true);
  assert.equal(isNonAdAsset("비광고성_외부_영상_미러링_에스파_잘_먹는_여돌_1위"), true);
  assert.equal(isNonAdAsset("⠿비광고성_외부영상_미러링_카리나_가지먹방"), true, "장식 문자가 붙어도");
});

test("일반 광고 소재는 비광고성이 아니다", () => {
  assert.equal(isNonAdAsset(AD_ASSET), false);
  assert.equal(isNonAdAsset("⠿" + AD_ASSET), false);
  assert.equal(isNonAdAsset(null), false);
  assert.equal(isNonAdAsset(""), false);
});

test("장식 문자만 벗기고 '['는 남긴다", () => {
  assert.ok(stripDecorativePrefix("⠿" + AD_ASSET).startsWith("["));
  // 하드코딩 목록이 아니라 카테고리 기반이라 새 장식 문자도 처리된다
  for (const deco of ["★", "▪", "→", "…", "· "]) {
    assert.ok(stripDecorativePrefix(deco + AD_ASSET).startsWith("["), deco);
  }
});

test("한글·숫자는 내용이므로 벗기지 않는다", () => {
  assert.equal(stripDecorativePrefix("비광고성_외부영상"), "비광고성_외부영상");
  assert.equal(stripDecorativePrefix("26.07 소재"), "26.07 소재");
});

test("비광고성 상품명 고정값은 '-' (기존 DB 46건과 동일 표기)", () => {
  assert.equal(NON_AD_PRODUCT_NAME, "-");
});
