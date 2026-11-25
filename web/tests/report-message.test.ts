// 자가치유 워치독의 '이미 게시됨' 판정 — 행동 계약.
//
// 🚨 2026-09-23 실사고: 판정이 본문 전체를 훑어, 09-21 리포트에 넣은 정정 주석
//    `정정(2026-09-22): …` 때문에 09-22 리포트가 이미 있다고 오판했다.
//    발송기(중복 방지)와 이 라우트(자가치유 probe)가 **같은 오판을 공유**해
//    1차와 백업이 동시에 무력화됐고, 3시간 26분간 아무 알림이 없었다.

import test from "node:test";
import assert from "node:assert/strict";

import { isReportForDate, REPORT_TITLE } from "../lib/report-message.ts";

const head = (d: string) => `📈 *${REPORT_TITLE}* \`(${d})\``;

test("제목줄이 그날이면 게시된 것이다", () => {
  assert.ok(isReportForDate(head("2026-09-22") + "\n오늘 총 증분 *+1,037,638*", "2026-09-22"));
});

test("다른 날 리포트는 그날 것이 아니다", () => {
  assert.ok(!isReportForDate(head("2026-09-21") + "\n오늘 총 증분 *+1,393,880*", "2026-09-22"));
});

test("🚨 본문 주석의 날짜를 '게시됨'으로 세면 안 된다(사고 재현)", () => {
  const edited = [
    head("2026-09-21"),
    "오늘 총 증분 *+1,393,880*",
    "_정정(2026-09-22): 인스타와 페이스북 교차게시 조회수를 합산했습니다._",
  ].join("\n");
  assert.ok(!isReportForDate(edited, "2026-09-22"),
    "본문 날짜가 새면 자가치유가 dispatch 를 건너뛴다 — 1차·백업이 동시에 죽는다");
  assert.ok(isReportForDate(edited, "2026-09-21"));
});

test("빈 값·다른 봇 메시지는 아니다", () => {
  for (const t of ["", null, undefined, "\n\n", "📊 *라라스윗 검색량 리포트* (2026-09-22 기준)"]) {
    assert.ok(!isReportForDate(t, "2026-09-22"));
  }
});

// ── 소스 계약 ────────────────────────────────────────────────────────
test("라우트가 공용 판정을 쓴다 — includes 로 본문을 훑으면 안 된다", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(
    join(import.meta.dirname, "../app/api/ops/ensure-daily-report/route.ts"), "utf8");
  assert.match(src, /isReportForDate\(m\.text, reportDate, p\.title\)/,
    "공용 판정을 안 쓰면 사고가 그대로 재발한다");
  assert.ok(!/m\.text\.includes\(/.test(src),
    "본문 전체 includes 판정이 남아 있다");
});

test("파이썬 쪽 정본과 짝이 유지된다 — 한쪽만 고치면 발송기와 자가치유가 갈린다", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const py = readFileSync(join(import.meta.dirname, "../../scripts/report_message.py"), "utf8");
  assert.match(py, /def is_report_for\(/);
  assert.match(py, /splitlines\(\)\[0\]/, "파이썬 쪽도 제목줄만 봐야 한다");
});

// ── 2026-10-28 바치케 미발송 사고: 자가치유가 제품별로 판정해야 한다 ──
test("제품별 판정 — 바치케 리포트는 쫀득바로, 쫀득바 리포트는 바치케로 보이지 않는다", async () => {
  const pb = "바치케 조회수 일일 증분";
  const jdMsg = "📈 *쫀득바 조회수 일일 증분* `(2026-10-27)`\n오늘 총 증분 *+1*";
  const pbMsg = ":바치케: *바치케 조회수 일일 증분* `(2026-10-27)`\n오늘 총 증분 *+1*";
  assert.ok(isReportForDate(jdMsg, "2026-10-27") && !isReportForDate(pbMsg, "2026-10-27"));
  assert.ok(isReportForDate(pbMsg, "2026-10-27", pb) && !isReportForDate(jdMsg, "2026-10-27", pb));
});

// ── 2026-11-25 바치케 → 크봉 교체(사용자 지시 "바치케 말고 크봉이 리포트를 보낼거야") ──
test("자가치유 대상은 쫀득바·크봉 — 중단된 바치케는 dispatch 하지 않는다, 크봉 판정은 제목 기준", async () => {
  const { REPORT_PRODUCTS } = await import("../lib/report-message.ts");
  assert.deepEqual(REPORT_PRODUCTS.map((p) => p.key), ["jd", "kbong"]);
  const kb = REPORT_PRODUCTS.find((p) => p.key === "kbong")!.title;
  const kbMsg = ":크봉이: *크봉 조회수 일일 증분* `(2026-11-25)`\n오늘 총 증분 *+1*";
  const jdMsg = "📈 *쫀득바 조회수 일일 증분* `(2026-11-25)`\n오늘 총 증분 *+1*";
  assert.ok(isReportForDate(kbMsg, "2026-11-25", kb) && !isReportForDate(jdMsg, "2026-11-25", kb));
  assert.ok(!isReportForDate(kbMsg, "2026-11-25"));
});

test("제품표가 파이썬 발송기와 짝 — 제목 = PRODUCT_PROFILES title + ' 조회수 일일 증분'", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { REPORT_PRODUCTS } = await import("../lib/report-message.ts");
  const notify = readFileSync(join(import.meta.dirname, "../../scripts/notify_increments.py"), "utf8");
  const pymsg = readFileSync(join(import.meta.dirname, "../../scripts/report_message.py"), "utf8");
  assert.match(pymsg, /조회수 일일 증분/);
  for (const p of REPORT_PRODUCTS) {
    const name = p.title.replace(" 조회수 일일 증분", "");
    assert.match(notify, new RegExp(`"${p.key}": \{"title": "${name}"`), `${p.key} 제목이 발송기와 다르다`);
  }
});

// ── 2026-11-25 사용자 지시 "협찬 글 없으면 크봉 리포트 보내지마" — 자가치유가 그날을 미게시로 보지 않는다 ──
test("크봉 제품명 판정 = 파이썬 정본과 같은 키, 자가치유는 협찬 글 없으면 dispatch 안 함", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { KBONG_KEYS, isKbongProduct } = await import("../lib/kbong.ts");
  const py = readFileSync(join(import.meta.dirname, "../../scripts/report_message.py"), "utf8");
  const m = py.match(/KBONG_KEYS = \(([^)]*)\)/);
  assert.ok(m, "파이썬 KBONG_KEYS 를 못 찾음");
  assert.deepEqual([...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]), [...KBONG_KEYS]);
  for (const n of ["크봉", "BB바", "bb말", "BB 초", "크런치 봉봉", "봉봉"]) assert.ok(isKbongProduct(n), n);
  for (const n of ["JD혼", "P바치", "B바", "", null]) assert.ok(!isKbongProduct(n), String(n));
  const { REPORT_PRODUCTS } = await import("../lib/report-message.ts");
  assert.equal(REPORT_PRODUCTS.find((p) => p.key === "kbong")!.requiresPosts, true);
  assert.equal(REPORT_PRODUCTS.find((p) => p.key === "jd")!.requiresPosts, false);
  const route = readFileSync(join(import.meta.dirname, "../app/api/ops/ensure-daily-report/route.ts"), "utf8");
  assert.match(route, /p\.requiresPosts && byProduct\[p\.key\] !== true && !\(await productHasPosts/);
  assert.match(route, /\.order\("id"\)\s*\.range\(from, from \+ 999\)/);   // 1,000행 절단 방지
});
