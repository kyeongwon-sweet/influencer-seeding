import assert from "node:assert/strict";
import test from "node:test";

import { companyForAccount, excludesCompanyFallback, repairPollutedCompanyName, isKnownCompanyName } from "../lib/companyMap.ts";

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

test("사소한 차이(대소문자·밑줄·점·공백)는 같은 채널로 매칭한다", () => {
  // Ufo__RED(맵) 기준: 밑줄 개수·대소문자·공백 달라도 같은 채널
  assert.equal(companyForAccount("Ufo_RED", "바이럴 (영상)"), "유머패밀리");   // 밑줄 1개
  assert.equal(companyForAccount("ufo red", "바이럴 (영상)"), "유머패밀리");   // 공백
  assert.equal(companyForAccount("LUNA.HUMOR", "바이럴 (영상)"), "루나앤코코"); // 대문자
  assert.equal(companyForAccount("laugh35", "바이럴 (영상)"), "굿띵투유");      // 점 제거(laugh.35)
});

test("Ufo 계열 신규 색상도 유머패밀리(예외 0)", () => {
  for (const a of ["ufo__green", "Ufo__GRAY", "ufo_white", "Ufo__yellow", "ufo__rainbow"]) {
    assert.equal(companyForAccount(a, "바이럴 (영상)"), "유머패밀리");
  }
});

test("맵에 없는 개인 계정은 null(업체명 없음)", () => {
  // 사용자 확정(2026-08-18): UFO 외 계열 의심 계정은 개인 처리
  for (const a of ["tree.zzal", "posilping_humor", "smile_nyang_s2", "luna.player", "humor__.cok", "김준서"]) {
    assert.equal(companyForAccount(a, "바이럴 (영상)"), null);
  }
});

test("업체명=계정명 오적재는 표기 차이까지 잡아 회사 맵 또는 null로 교정한다", () => {
  assert.deepEqual(
    repairPollutedCompanyName("Ufo_RED", "ufo__red", "바이럴 (영상)"),
    { companyName: "유머패밀리", polluted: true },
  );
  assert.deepEqual(
    repairPollutedCompanyName("Tree Zzal", "tree.zzal", "바이럴 (영상)"),
    { companyName: null, polluted: true },
  );
  assert.deepEqual(
    repairPollutedCompanyName("정상 업체", "tree.zzal", "바이럴 (영상)"),
    { companyName: "정상 업체", polluted: false },
  );
});

test("ascii 핸들꼴 업체명(계정 조각·외부 핸들)도 오적재로 잡는다", () => {
  // ⚠️ 2026-08-19 정정: 원래 여기서 '486'을 486__humor의 조각으로 보고 오염 판정했으나,
  //    사용자 확인 결과 **486이 정식 사명**이었다. 정식 사명은 COMPANY_ACCOUNTS로 보호되므로
  //    이 케이스는 아래 '등록되지 않은 ascii 핸들'로 대체한다(규칙 자체는 그대로 유효).
  assert.deepEqual(
    repairPollutedCompanyName("zzal_maker", "zzal_maker_official", "바이럴 (영상)"),
    { companyName: null, polluted: true },
  );
  // ascii 핸들꼴이 우리채널 계정 위에 있으면 그 업체명으로 교정
  assert.deepEqual(
    repairPollutedCompanyName("ssul_snack", "ufo__red", "바이럴 (영상)"),
    { companyName: "유머패밀리", polluted: true },
  );
  // 한글/공백 포함 정식 업체명은 오염 아님(보존)
  assert.equal(repairPollutedCompanyName("톡톡컴퍼니", "486__humor", "바이럴 (영상)").polluted, false);
  assert.equal(repairPollutedCompanyName("스튜디오 엔터", "some_acct", "바이럴 (영상)").polluted, false);
});


test("🚨 숫자·영문 정식 사명을 계정 핸들로 오판해 지우지 않는다 (486 사건, 2026-08-19)", () => {
  // ascii 핸들꼴 규칙이 '486'을 486__humor의 조각으로 오판해 시트 정상값을 지웠다(활성 5건 빈칸).
  const r = repairPollutedCompanyName("486", "486__humor", "바이럴 (영상)");
  assert.equal(r.polluted, false);
  assert.equal(r.companyName, "486");
  // 매핑도 등록돼 폴백으로도 같은 값이 나온다.
  assert.equal(companyForAccount("486__humor", "바이럴 (영상)"), "486");
  assert.equal(isKnownCompanyName("486"), true);
});

test("정식 사명이 아닌 ascii 핸들은 여전히 오염으로 잡는다", () => {
  // 486 예외가 규칙 자체를 무력화하면 안 된다.
  const r = repairPollutedCompanyName("some_random_handle", "some_random_handle", "바이럴 (영상)");
  assert.equal(r.polluted, true);
  assert.equal(isKnownCompanyName("some_random_handle"), false);
});
