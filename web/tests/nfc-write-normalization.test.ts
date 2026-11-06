// 맥에서 복사한 글자는 한글이 자모로 쪼개진 형태(NFD)로 들어온다(2026-11-06 사용자 지적).
// 화면엔 똑같아 보여도 "파인트"·"떵개" 검색·판정이 전부 빗나간다 — 소재명 22행이 이렇게 DB까지 들어갔다.
// DB에 쓰는 공통 지점에서 보통 한글(NFC)로 합쳐 저장하는지 실제 함수로 확인한다.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeSpacing, canonicalText, normalizeChannelType, toNfc } from "../app/monitoring/lib.ts";
import { stripAssetFileListing } from "../lib/asset-name-policy.ts";

// 실제 시트 5138행 소재명(원본이 NFD)
const ASSET = "[26.10]F_V_P바치_인지_바치케출시_바이럴형_맛잘알권위_var3.릴스_떵개파급력.유행어강조.떡잎부터남다른스타성.X_파인트__261030_빙과_박채현";
const NFD = ASSET.normalize("NFD");

test("전제: NFD는 눈에 같아 보여도 다른 문자열이고 '파인트' 검색이 안 맞는다", () => {
  assert.notEqual(NFD, ASSET);
  assert.equal(NFD.includes("파인트"), false);
});

test("🚨 소재명 쓰기 경로(파일목록 제거→표준화)를 지나면 보통 한글이 된다", () => {
  const out = canonicalText(stripAssetFileListing(NFD), "asset_name");
  assert.equal(out, ASSET);
  assert.ok(out!.includes("파인트") && out!.includes("떵개"));
});

test("자모로 쪼개진 '속지'·'표지' 파일목록도 떼어낸다", () => {
  assert.equal(stripAssetFileListing("[26.08]F_V_JD멜_빙과_최재헌.mp4, 2. 속지.mp4".normalize("NFD")), "[26.08]F_V_JD멜_빙과_최재헌");
});

test("계정명·업체명 등 이름류, 채널분류, 공용 헬퍼도 합친다", () => {
  assert.equal(normalizeSpacing("떵개떵개".normalize("NFD")), "떵개떵개");
  assert.equal(canonicalText("모두의 행복".normalize("NFD"), "company_name"), "모두의행복", "합친 뒤 별칭도 적용");
  assert.equal(normalizeChannelType("바이럴(영상)".normalize("NFD")), "바이럴 (영상)");
  assert.equal(toNfc("캡션".normalize("NFD")), "캡션");
});

test("이미 보통 한글·영문·이모지는 그대로", () => {
  assert.equal(canonicalText(ASSET, "asset_name"), ASSET);
  assert.equal(toNfc("hello 😀 ㅋㅋ"), "hello 😀 ㅋㅋ");
});

test("🚨 기존 DB의 NFD 값은 다음 동기화 때 '다른 값'으로 보여 자동으로 고쳐진다(변경분 비교가 문자 그대로)", () => {
  const sheet = canonicalText(stripAssetFileListing(NFD), "asset_name");
  const db = NFD; // 현재 DB 22건 상태
  assert.notEqual(String(sheet).trim(), String(db).trim());
  const src = readFileSync(new URL("../lib/sponsored-write.ts", import.meta.url), "utf8");
  assert.match(src, /if \(String\(val\)\.trim\(\) === String\(ex\[f\] \?\? ""\)\.trim\(\)\) continue;/);
});

test("캡션·사업명·상품명 쓰기 경로도 합친다(소스 계약)", () => {
  const write = readFileSync(new URL("../lib/sponsored-write.ts", import.meta.url), "utf8");
  assert.match(write, /content_summary: r\.content_summary \? toNfc\(String\(r\.content_summary\)\) : null/);
  const mk = readFileSync(new URL("../app/api/marketing/sync/route.ts", import.meta.url), "utf8");
  assert.match(mk, /project_name: r\.project_name \? toNfc\(/);
  assert.match(mk, /r\.product_name \? toNfc\(/);
});
