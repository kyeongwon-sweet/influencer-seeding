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
  assert.match(src, /isReportForDate\(m\.text, reportDate\)/,
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
