// '시트에만 있고 DB에 없는 게시물' 감사 — 행동 계약 (2026-10-13 추가).
//
// 🚨 실사고: 연동시트 4908·4909행 주소가 `instagram.com/reel/...`(https:// 없음)이라 Apps Script 의
//    `^https://` 검사에 걸려 DB로 아예 안 넘어갔다. 서버는 정규화 후 받아주는 주소였다.
//    DB에 없으니 수집·업로드일 채움·조회수 역채움이 전부 없었고, 기존 감사의 '값 정체' 검사는
//    DB에 짝이 있는 행만 봐서(`eligible = p0 && ...`) 이 행들은 어떤 집계에도 안 걸렸다.
//    사람이 "왜 업로드일이 안 채워지냐"고 물어서야 드러났고, 같은 날 4998행이 또 생겼다.
//
// 도입 직전 전수 실측(시트 4,992행): 진짜 누락 2건(http·https 누락), 틱톡 단축주소 51건은
// 전부 DB에 있었다(오프라인 대조 불가 → 제외해야 오탐이 안 난다), 미지원 주소 5건.

import test from "node:test";
import assert from "node:assert/strict";

import { auditRows, formatAuditMessage, type SheetAuditRow } from "../lib/formula-audit.ts";
import { classifySheetPostUrl } from "../lib/url-utils.ts";

const RANGE = { firstColumn: "P", lastColumn: "ET", targetColumn: "ET" };

function row(over: Partial<SheetAuditRow> = {}): SheetAuditRow {
  return { key: "ig:AAA", label: "테스트", sourceRow: 4998, h: null, inc: null, metricRange: RANGE, dates: [], ...over };
}
function post() {
  return { posted: "2026-10-01", ended: null, channelType: "무상시딩 (영상)", staleExclusionReason: null, measured: new Map() };
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const audit = (rows: SheetAuditRow[], posts = new Map<string, any>()) =>
  auditRows(rows, posts, "2026-10-13", [], "2026-10-12");

// ── URL 분류는 서버가 실제로 받는 순서(정규화 → 검사)를 따른다 ─────────────────
test("사고 주소: https:// 없는 인스타·http 유튜브는 서버가 받는 게시물이다", () => {
  assert.equal(classifySheetPostUrl("instagram.com/reel/DeVzfGRBw_l/"), "post");
  assert.equal(classifySheetPostUrl("http://youtube.com/watch?v=7brYyMz4wZ0"), "post");
});

test("틱톡 단축주소는 대조 불가로 분리한다 — 서버는 풀어서 저장하므로 DB 키와 안 맞는다", () => {
  assert.equal(classifySheetPostUrl("https://vt.tiktok.com/ZSb7Bmob3/"), "short");
  assert.equal(classifySheetPostUrl("vt.tiktok.com/ZSb7Bmob3/"), "short");
});

test("서버도 거부하는 주소는 미지원으로 센다", () => {
  for (const u of [
    "https://www.instagram.com/time_holy/reels/",   // 프로필 릴스 탭
    "https://naver.me/58qsmqEv",                     // 네이버 단축
    "https://m.cafe.daum.net/ok1221/9Zdf/2962938",   // 미지원 도메인
    "",
  ]) assert.equal(classifySheetPostUrl(u), "unsupported", u);
});

// ── 감사 ─────────────────────────────────────────────────────────────
test("🚨 게시물 주소인데 DB에 없으면 시트에만 있는 행으로 잡는다(사고 재현)", () => {
  const r = audit([row({ url: "instagram.com/reel/DeVzfGRBw_l/", urlKind: "post", label: "0r_jeong" })]);
  assert.equal(r.sheetOnly, 1);
  assert.deepEqual(r.sheetOnlyRows[0], { row: 4998, label: "0r_jeong", url: "instagram.com/reel/DeVzfGRBw_l/" });
});

test("DB에 있으면 잡지 않는다", () => {
  const r = audit([row({ urlKind: "post" })], new Map([["ig:AAA", post()]]));
  assert.equal(r.sheetOnly, 0);
});

test("단축주소·미지원은 시트에만 있어도 경보에 넣지 않고 따로 센다", () => {
  const r = audit([
    row({ key: "url:vt", urlKind: "short" }),
    row({ key: "url:daum", urlKind: "unsupported" }),
  ]);
  assert.equal(r.sheetOnly, 0);
  assert.equal(r.shortLinkRows, 1);
  assert.equal(r.unsupportedUrlRows, 1);
});

test("urlKind 가 없으면 감사하지 않는다 — 기존 호출부 호환", () => {
  assert.equal(audit([row()]).sheetOnly, 0);
});

test("🚨 메시지 맨 앞에 행 번호와 주소를 띄우고, 정상(healthy)으로 보고하지 않는다", () => {
  const r = audit([row({ url: "instagram.com/reel/DeVzfGRBw_l/", urlKind: "post", label: "0r_jeong" })]);
  const { text, healthy } = formatAuditMessage(r);
  assert.ok(text.startsWith("🔴 시트에만 있고 DB에 없는 게시물 1건"), text.slice(0, 60));
  assert.match(text, /행 4998 0r_jeong — instagram\.com\/reel\/DeVzfGRBw_l\//);
  assert.equal(healthy, false, "수식이 멀쩡해도 이 행이 있으면 '이상 없음'으로 읽히면 안 된다");
});

test("시트에만 있는 행이 없으면 메시지는 종전 그대로다", () => {
  const { text } = formatAuditMessage(audit([row({ urlKind: "post" })], new Map([["ig:AAA", post()]])));
  assert.ok(!text.includes("시트에만 있고"));
});

test("라우트가 URL 분류를 실제로 넘기고 일일 원장에 남긴다(소스 계약)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(join(import.meta.dirname, "../app/api/sponsored-posts/formula-audit/route.ts"), "utf8");
  assert.match(src, /urlKind: classifySheetPostUrl\(url\)/, "분류를 안 넘기면 감사가 통째로 꺼진다");
  assert.match(src, /sheetOnly: result\.sheetOnly/, "원장에 안 남기면 추이를 볼 수 없다");
});
