import { test } from "node:test";
import assert from "node:assert/strict";
import { accountNameForSponsoredWrite, isViralInstagram } from "../lib/account-name-policy.ts";

test("Instagram 바이럴은 실제 핸들만 허용한다", () => {
  const url = "https://www.instagram.com/reel/ABC_123/";
  assert.equal(isViralInstagram(url, "바이럴 (영상)"), true);
  assert.equal(accountNameForSponsoredWrite(url, "바이럴 (영상)", "smile_today_s2"), "smile_today_s2");
  assert.equal(accountNameForSponsoredWrite(url, "바이럴 (배너)", "@ufo__pink"), "ufo__pink");
  assert.equal(accountNameForSponsoredWrite(url, "바이럴 (영상)", "스마일 투데이"), null);
  assert.equal(accountNameForSponsoredWrite(url, "바이럴 (영상)", "happy__pyeong (표지)"), null);
});

test("비-Instagram 또는 비-바이럴 채널명은 기존 정책을 유지한다", () => {
  assert.equal(
    accountNameForSponsoredWrite("https://www.youtube.com/shorts/abc", "바이럴 (영상)", "유튜브 표시명"),
    "유튜브 표시명",
  );
  assert.equal(
    accountNameForSponsoredWrite("https://www.instagram.com/reel/ABC_123/", "협찬", "브랜드 표시명"),
    "브랜드 표시명",
  );
});
