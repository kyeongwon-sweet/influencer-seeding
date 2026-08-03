import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRows, formatAuditMessage, isMetriclessChannel, type AuditPost, type SheetAuditRow } from "../lib/formula-audit.ts";

// 2026-08-03 사고 회귀: 삭제된 74건과 게시일 불일치로 버려진 6건이 며칠째 값이 멈춰 있었는데,
// 시트끼리는 앞뒤가 맞아 이 감사가 나흘 내리 "이상 없음"으로 보고했다.
// 수식 정합만으로는 '값이 통째로 안 들어온다'를 알 수 없다 → 정체 검사를 함께 돌린다.

const TODAY = "2026-08-03";

function mkPost(over: Partial<AuditPost> = {}): AuditPost {
  return { posted: "2026-07-01", ended: null, channelType: "바이럴 (영상)", measured: new Map(), ...over };
}

function mkRow(label: string, dates: Array<[string, number]>): SheetAuditRow {
  const ds = dates.map(([date, value]) => ({ date, value }));
  const last = ds.length ? ds[ds.length - 1].value : null;
  const max = ds.length ? Math.max(...ds.map(d => d.value)) : null;
  const prevMax = ds.length > 1 ? Math.max(...ds.slice(0, -1).map(d => d.value)) : null;
  return {
    key: label,
    label,
    h: max,                                            // 누적 = 그 행 최대(정합)
    inc: ds.length ? (prevMax === null ? last : Math.max(0, (last as number) - prevMax)) : null,
    dates: ds,
  };
}

function run(rows: SheetAuditRow[], posts: Array<[string, AuditPost]>) {
  return auditRows(rows, new Map(posts), TODAY);
}

test("사고 재현: 활성 게시물인데 값이 7/30에서 멈췄으면 정체로 잡는다", () => {
  const row = mkRow("Ufo__green", [["2026-07-29", 3000], ["2026-07-30", 3655]]);
  const r = run([row], [["Ufo__green", mkPost()]]);
  assert.equal(r.stale, 1);
  assert.match(r.staleNotes[0], /값정체 Ufo__green: 마지막 값 2026-07-30/);
  // 수식 자체는 정합이라 기존 지표는 깨끗해야 한다 — 그게 이 사각의 본질
  assert.equal(r.h.errorCells + r.h.emptyButData + r.inc.errorCells + r.inc.mismatch, 0);
});

test("메시지가 '이상 없음'만 말하지 않고 정체를 반드시 덧붙인다", () => {
  const row = mkRow("Ufo__green", [["2026-07-30", 3655]]);
  const { text, healthy } = formatAuditMessage(run([row], [["Ufo__green", mkPost()]]));
  assert.match(text, /수식 이상 없음/);
  assert.match(text, /값 정체 1건/);
  assert.equal(healthy, false, "정체가 있으면 healthy가 아니어야 한다");
});

test("어제까지 값이 들어왔으면 정체 아님", () => {
  const row = mkRow("정상글", [["2026-08-01", 100], ["2026-08-02", 120]]);
  const r = run([row], [["정상글", mkPost()]]);
  assert.equal(r.stale, 0);
  assert.equal(formatAuditMessage(r).healthy, true);
});

test("종료글은 값이 멈춰 있어도 정체 아님(정상)", () => {
  const row = mkRow("종료글", [["2026-07-20", 500]]);
  const r = run([row], [["종료글", mkPost({ ended: "2026-08-03" })]]);
  assert.equal(r.stale, 0);
});

test("배너·피드·위성/온드는 매일 값이 없는 게 정상 — 제외", () => {
  for (const ct of ["바이럴 (배너)", "협찬 (피드)", "위성채널", "온드미디어"]) {
    assert.equal(isMetriclessChannel(ct), true, ct);
    const r = run([mkRow(ct, [["2026-07-20", 10]])], [[ct, mkPost({ channelType: ct })]]);
    assert.equal(r.stale, 0, ct);
  }
  assert.equal(isMetriclessChannel("바이럴 (영상)"), false);
});

test("갓 올린 글(어제 게시)은 아직 값이 없어도 정체 아님", () => {
  const row: SheetAuditRow = { key: "신규", label: "신규", h: null, inc: null, dates: [] };
  const r = run([row], [["신규", mkPost({ posted: "2026-08-02" })]]);
  assert.equal(r.stale, 0);
});

test("오래된 활성 글인데 값이 한 번도 없으면 정체", () => {
  const row: SheetAuditRow = { key: "무측정", label: "무측정", h: null, inc: null, dates: [] };
  const r = run([row], [["무측정", mkPost({ posted: "2026-07-01" })]]);
  assert.equal(r.stale, 1);
  assert.match(r.staleNotes[0], /마지막 값 없음/);
});

test("DB에 없는 행은 판단하지 않는다(오탐 방지)", () => {
  const r = run([mkRow("미등록", [["2026-07-20", 10]])], []);
  assert.equal(r.stale, 0);
});
