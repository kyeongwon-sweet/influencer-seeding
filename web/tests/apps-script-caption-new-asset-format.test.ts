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
