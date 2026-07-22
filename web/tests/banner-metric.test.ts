import assert from "node:assert/strict";
import test from "node:test";
import { isBannerChannelType } from "../lib/banner-metric.ts";

test("recognizes Korean and English banner channel types", () => {
  assert.equal(isBannerChannelType("바이럴 (배너)"), true);
  assert.equal(isBannerChannelType("Viral Banner"), true);
  assert.equal(isBannerChannelType("바이럴 (영상)"), false);
  assert.equal(isBannerChannelType(null), false);
});
