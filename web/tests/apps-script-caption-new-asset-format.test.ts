// 연동시트 캡션 = 소재명 파생 규칙(captionFromAssetName_) — 10월 말 새 소재명 형식도 인식.
// 2026-11-03 사용자: "소재명에서 규칙에 맞으면 캡션에 자동적용하기로 했잖아".
//   새 형식은 제품 표시에 P가 없고(스틱바·파인트) 기획자 칸이 빈칸이라 규칙이 빈 값을 돌려줬다
//   → 바이럴 행의 스크랩 해시태그 캡션이 그대로 남았다(실측 17행, 2026-10-29~31).
// 아래 소재명은 모두 RD 시트 실제 값이다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appsScript = readFileSync(join(import.meta.dirname, "../../Combined_Sheet_AppsScript.gs"), "utf8");
const src = appsScript.slice(appsScript.indexOf("function cleanAssetCaption_("), appsScript.indexOf("function fillCaptionFromAsset_()"));
const cap = new Function(`${src}; return captionFromAssetName_;`)() as (asset: string, type: string) => string;

const V = "바이럴 (영상)";

test("🚨 새 형식(스틱바, P 없음·기획자 칸 빈칸)도 캡션을 뽑는다", () => {
  assert.equal(
    cap("[26.10]F_V_JD복_인지_복쫀바출시_유명인활용형__main.렉카_소혜.여돌냉장고에이런거들어있어도되는거예요.흰.안예빈.X_스틱바__261029_빙과_이채윤", V),
    "소혜.여돌냉장고에이런거들어있어도되는거예요.흰.안예빈",
  );
});

test("새 형식(파인트, P 없음)도 캡션을 뽑는다", () => {
  assert.equal(
    cap("[26.10]F_V_P바치_인지_바치케출시_바이럴형_맛잘알권위_main.릴스_대세감파급력.AI먹방.떵개ai아닌거확실함.X_파인트__261030_빙과_박채현", V),
    "대세감파급력.AI먹방.떵개ai아닌거확실함",
  );
});

test("옛 형식(2P·파인트P·스틱바P)은 그대로", () => {
  assert.equal(cap("[26.06]F_V_JD망_바이럴_쫀득바출시_바이럴형_썰풀기형_var3.릴스_검.온라인파묘.X_2P_이재원_260610_빙과_유영현", V), "검.온라인파묘");
  assert.equal(cap("F_V_P혼_바이럴_말차재입고_바이럴형_커뮤니티_var3.렉카_성분비교.제로가아님.X_스틱바P_손유곤_260818_빙과_유영현", V), "성분비교.제로가아님");
});

test("숫자만 있고 P가 없으면 여전히 인정하지 않는다(오탐 방지)", () => {
  assert.equal(cap("[26.10]F_V_JD복_바이럴_x_y_main.렉카_어떤문장.X_2__261029_빙과_누구", V), "");
});

// ── 정책: 새 형식은 해시태그가 없어도 소재명 캡션으로(2026-11-03 사용자 "새 형식만 전부") ──
function runFill(rows: Array<{ asset: string; caption: string; type: string }>) {
  const fillSrc = appsScript.slice(appsScript.indexOf("function isNewViralAssetFormat_("), appsScript.indexOf("// 캡션 열만 수동 재적용할 때"));
  const edits: Array<{ row: number; value: string }> = [];
  const cols: Record<string, number> = { 소재명: 5, 캡션: 13, 채널분류: 4 };
  const sheet = {
    getLastRow: () => 1 + rows.length,
    getRange: (_r: number, col: number) => ({
      getValues: () => rows.map((x) => [col === 5 ? x.asset : col === 13 ? x.caption : x.type]),
    }),
  };
  const fn = new Function("getSheet_", "findHeaderCol_", "writeColumnRuns_", "Logger", "CONFIG",
    `${src}\n${fillSrc}\nreturn fillCaptionFromAsset_;`)(
    () => sheet,
    (_s: unknown, names: string[]) => cols[names[0]] ?? null,
    (_s: unknown, _c: number, e: typeof edits) => { edits.push(...e); return e.length; },
    { log: () => {} },
    { DATA_START_ROW: 2 },
  );
  fn();
  return edits;
}

const NEW_ASSET = "[26.10]F_V_P바치_인지_바치케출시_바이럴형_맛잘알권위_main.릴스_대세감파급력.AI먹방.떵개ai아닌거확실함.X_파인트__261030_빙과_박채현";
const OLD_ASSET = "[26.06]F_V_JD망_바이럴_쫀득바출시_바이럴형_썰풀기형_var3.릴스_검.온라인파묘.X_2P_이재원_260610_빙과_유영현";

test("🚨 새 형식 + 해시태그 없는 문장 캡션 → 소재명 캡션으로 바꾼다(실제 5159행)", () => {
  const e = runFill([{ asset: NEW_ASSET, caption: "이게 AI가 아니라고???", type: V }]);
  assert.deepEqual(e, [{ row: 2, value: "대세감파급력.AI먹방.떵개ai아닌거확실함" }]);
});

test("옛 형식 + 해시태그 없는 문장 캡션 → 그대로 보존(2026-08-24 정책 유지)", () => {
  assert.deepEqual(runFill([{ asset: OLD_ASSET, caption: "유행빵의 원가, 알고 나면 놀라는 이유", type: V }]), []);
});

test("옛 형식 + 해시태그 캡션 → 지금처럼 교체", () => {
  assert.deepEqual(runFill([{ asset: OLD_ASSET, caption: "유행빵 #먹방 #간식", type: V }]), [{ row: 2, value: "검.온라인파묘" }]);
});

test("이미 소재명 캡션이면 다시 쓰지 않는다", () => {
  assert.deepEqual(runFill([{ asset: NEW_ASSET, caption: "대세감파급력.AI먹방.떵개ai아닌거확실함", type: V }]), []);
});

// ── 자모로 쪼개진 소재명(NFD, 맥 파일명) — 2026-11-06 사용자 지적 ──
// 5138~5144·5156~5158·5237~5243·5287~5291(22행) 소재명이 NFD로 붙여넣어져 "파인트"·"릴스"가
// 글자로 안 맞았다 → 캡션을 못 뽑고 게시물 캡션("진짜 스타성 ㄹㅈㄷ임…")이 남았다.
// 아래 소재명은 실제 5138행 값을 그대로 NFD로 만든 것(시트 원본이 이 형태).
const NFD_ASSET = "[26.10]F_V_P바치_인지_바치케출시_바이럴형_맛잘알권위_var3.릴스_떵개파급력.유행어강조.떡잎부터남다른스타성.X_파인트__261030_빙과_박채현".normalize("NFD");

test("🚨 자모로 쪼개진(NFD) 새 형식 소재명도 캡션을 뽑고, 결과는 보통 한글(NFC)", () => {
  assert.notEqual(NFD_ASSET, NFD_ASSET.normalize("NFC"), "테스트 전제: 원본이 NFD");
  const got = cap(NFD_ASSET, V);
  assert.equal(got, "떵개파급력.유행어강조.떡잎부터남다른스타성");
  assert.equal(got, got.normalize("NFC"));
});

test("🚨 NFD 소재명 + 게시물 문장 캡션 → 소재명 캡션으로 바꾼다(실제 5138행)", () => {
  assert.deepEqual(
    runFill([{ asset: NFD_ASSET, caption: "진짜 스타성 ㄹㅈㄷ임ㅋㅋㅋㅋㅋ", type: V }]),
    [{ row: 2, value: "떵개파급력.유행어강조.떡잎부터남다른스타성" }],
  );
});

test("NFD 옛 형식 문장 캡션은 여전히 보존(정책 그대로)", () => {
  assert.deepEqual(runFill([{ asset: OLD_ASSET.normalize("NFD"), caption: "유행빵의 원가, 알고 나면 놀라는 이유", type: V }]), []);
});
