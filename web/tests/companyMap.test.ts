import assert from "node:assert/strict";
import test from "node:test";

import { companyForAccount, excludesCompanyFallback } from "../lib/companyMap.ts";

test("company fallback remains available for viral channels", () => {
  assert.equal(companyForAccount("365_real", "바이럴 (영상)"), "굿띵투유");
  assert.equal(companyForAccount("jolly__humor", "바이럴(배너)"), "루나앤코코");
});

test("owned and satellite channels do not use account-based company fallback", () => {
  assert.equal(excludesCompanyFallback("온드미디어"), true);
  assert.equal(excludesCompanyFallback("위성채널"), true);
  assert.equal(companyForAccount("365_real", "온드미디어"), null);
  assert.equal(companyForAccount("jolly__humor", "위성채널"), null);
});

