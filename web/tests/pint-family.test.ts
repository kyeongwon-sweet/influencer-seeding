// 파인트 묶음 — P바치(바치케 파인트) 포함 계약 (2026-10-16 추가).
//
// 🚨 바치케 파인트 코드 `P바치`는 한글이 2자라 '영문+한글 1자' 가정에서 빠지기 쉽다
//    (인지 Streamlit 대시보드는 이 가정 때문에 1,642행을 (기타)로 버렸다).
//    사용자 지시: "무상노출, 협찬 모니터링 전부 P바치를 파인트로 포함해".

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isPintProduct } from "../lib/productCode.ts";

test("🚨 P바치는 파인트다", () => {
  assert.equal(isPintProduct("P바치"), true);
});

test("DB에 실제 있는 파인트 코드 전부 파인트(2026-10-16 실측: P망·P말·P혼·P바치·P요·P골·P바)", () => {
  for (const c of ["P망", "P말", "P혼", "P바치", "P요", "P골", "P바"]) assert.equal(isPintProduct(c), true, c);
});

test("팝콘(PC…)·다른 제품군·빈값은 파인트가 아니다", () => {
  for (const c of ["PC혼", "PC카", "JD혼", "BA딸", "DB딸", "-", "", null, undefined]) {
    assert.equal(isPintProduct(c as string | null | undefined), false, String(c));
  }
});

test("상품명으로 들어온 행도 파인트로 본다", () => {
  assert.equal(isPintProduct("바스크치즈케이크파인트"), true);
  assert.equal(isPintProduct("망고요거트 파인트"), true);
});

test("협찬 필터엔 '파인트' 묶음 칩이 없다 — 2026-10-20 사용자 지시로 삭제(되살리지 말 것)", () => {
  const src = readFileSync(join(import.meta.dirname, "../app/monitoring/components/FiltersBar.tsx"), "utf8");
  assert.doesNotMatch(src, />파인트<\/button>/);
  assert.doesNotMatch(src, /__pint_family/);
});

test("무상노출 파인트 묶음에 바치케·라즈베리오렌지·애플민트 파인트 표기가 있다(소스 계약)", () => {
  const src = readFileSync(join(import.meta.dirname, "../app/organic/page.tsx"), "utf8");
  const pint = src.slice(src.indexOf('"파인트": ['), src.indexOf("],", src.indexOf('"파인트": [')));
  assert.match(pint, /"바스크치즈케이크파인트"/);
  assert.match(pint, /"라즈베리오렌지파인트"/);
  assert.match(pint, /"애플민트파인트"/);
});
