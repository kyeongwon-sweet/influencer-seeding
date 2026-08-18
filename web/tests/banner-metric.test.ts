import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { isBannerChannel } from "../app/monitoring/lib.ts";

test("recognizes explicit banners and applies the magazine posted-date boundary", () => {
  assert.equal(isBannerChannel("바이럴 (배너)"), true);
  assert.equal(isBannerChannel("Viral Banner"), true);
  assert.equal(isBannerChannel("바이럴 (영상)"), false);
  assert.equal(isBannerChannel("협찬 (파워채널/매거진)", "2026-06-30"), false);
  assert.equal(isBannerChannel("협찬 (파워채널/매거진)", "2026-08-18"), true);
  assert.equal(isBannerChannel("협찬 (파워채널/매거진)"), false);
  assert.equal(isBannerChannel(null), false);
});

test("collection entry points use the canonical posted-date-aware banner rule", () => {
  for (const file of [
    "app/api/apify-webhook/route.ts",
    "app/api/monitoring/collect-now/route.ts",
  ]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /isBannerChannel\(post\.channel_type, post\.posted_at\)/, file);
    assert.doesNotMatch(source, /isBannerChannelType/, file);
  }
});
