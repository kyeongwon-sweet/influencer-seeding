import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRejectedInvalidUrlAlert,
  formatRejectedInvalidUrlAlert,
  rejectedUrlIdentifiers,
} from "../lib/stats-import-alerts.ts";

test("invalid TikTok alert includes unique account and URL samples", () => {
  const invalid = "https://www.tiktok.com/@ssulbox_1/video/76543907066471252699/";
  const message = formatRejectedInvalidUrlAlert(2, [invalid, invalid]);

  assert.match(message, /잘못된 TikTok 게시물 ID 2건 차단/);
  assert.match(message, /@ssulbox_1 https:\/\/www\.tiktok\.com\/@ssulbox_1\/video\/76543907066471252699\//);
  assert.equal(message.match(/76543907066471252699/g)?.length, 1);
});

test("invalid TikTok alert limits URL samples to six", () => {
  const urls = Array.from(
    { length: 7 },
    (_, index) => `https://www.tiktok.com/@account${index}/video/1844674407370955161${index}/`,
  );
  const message = formatRejectedInvalidUrlAlert(7, urls);

  assert.match(message, /@account0/);
  assert.match(message, /@account5/);
  assert.doesNotMatch(message, /@account6/);
});

test("ended invalid TikTok rejection is blocked silently", () => {
  const invalid = "https://www.tiktok.com/@ssulbox_1/video/76543907066471252699/";
  const endedIdentifiers = new Set(rejectedUrlIdentifiers(invalid));

  assert.equal(buildRejectedInvalidUrlAlert([invalid], endedIdentifiers), null);
});

test("active invalid TikTok rejection sends its account and URL", () => {
  const invalid = "https://www.tiktok.com/@active_account/video/76543907066471252699/";
  const message = buildRejectedInvalidUrlAlert([invalid], new Set());

  assert.match(message ?? "", /잘못된 TikTok 게시물 ID 1건 차단/);
  assert.match(message ?? "", /@active_account https:\/\/www\.tiktok\.com\/@active_account\/video\/76543907066471252699\//);
});
