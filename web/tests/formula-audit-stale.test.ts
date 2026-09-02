import { test } from "node:test";
import assert from "node:assert/strict";
import { auditRows, formatAuditMessage, isMetriclessChannel, type AuditPost, type SheetAuditRow } from "../lib/formula-audit.ts";

// 2026-08-03 사고 회귀: 삭제된 74건과 게시일 불일치로 버려진 6건이 며칠째 값이 멈춰 있었는데,
// 시트끼리는 앞뒤가 맞아 이 감사가 나흘 내리 "이상 없음"으로 보고했다.
// 수식 정합만으로는 '값이 통째로 안 들어온다'를 알 수 없다 → 정체 검사를 함께 돌린다.

const TODAY = "2026-08-03";

// ⚠️ 정체 판정은 **DB 실측(measured)** 기준이다. 시트 I는 target일 미측정이면 공란이지만,
//    삭제·수집실패 원인 판정은 여전히 DB 실측 이력이 정본이다.
function mkPost(measured: Array<[string, number]> = [], over: Partial<AuditPost> = {}): AuditPost {
  return {
    posted: "2026-07-01",
    ended: null,
    channelType: "바이럴 (영상)",
    measured: new Map(measured),
    ...over,
  };
}

function mkRow(label: string, dates: Array<[string, number]>, key = label): SheetAuditRow {
  const ds = dates.map(([date, value]) => ({ date, value }));
  const max = ds.length ? Math.max(...ds.map(d => d.value)) : null;
  const targetDate = "2026-08-02";
  const target = ds.find((d) => d.date === targetDate)?.value ?? null;
  const previous = ds.filter((d) => d.date < targetDate).map((d) => d.value);
  return {
    key,
    label,
    h: max,                                            // 누적 = 그 행 최대(정합)
    inc: target == null ? null : previous.length ? Math.max(0, target - Math.max(...previous)) : target,
    dates: ds,
  };
}

function run(rows: SheetAuditRow[], posts: Array<[string, AuditPost]>) {
  return auditRows(rows, new Map(posts), TODAY);
}

test("사고 재현: 실측이 7/30에서 멈췄으면 정체로 잡는다", () => {
  const row = mkRow("Ufo__green", [["2026-07-29", 3000], ["2026-07-30", 3655]]);
  const r = run([row], [["Ufo__green", mkPost([["2026-07-29", 3000], ["2026-07-30", 3655]])]]);
  assert.equal(r.stale, 1);
  assert.match(r.staleNotes[0], /값정체 Ufo__green \(Ufo__green\): 마지막 실측 2026-07-30/);
  // 수식 자체는 정합이라 기존 지표는 깨끗해야 한다 — 그게 이 사각의 본질
  assert.equal(r.h.errorCells + r.h.emptyButData + r.inc.errorCells + r.inc.mismatch, 0);
});

test("값 정체 알림은 같은 계정의 여러 게시물을 구분할 수 있게 URL key를 포함한다", () => {
  const key = "ig:DbArSYTujGW";
  const row = mkRow("ufo__blue", [], key);
  const r = run([row], [[key, mkPost([])]]);
  assert.equal(r.stale, 1);
  assert.match(r.staleNotes[0], /값정체 ufo__blue \(ig:DbArSYTujGW\): 마지막 실측 없음/);
});

test("🚨 시트가 '공백 이어받기'로 최근 날짜까지 채워져 있어도, 실측이 끊겼으면 정체로 잡는다", () => {
  // 실제 사고 형태: 시트엔 8/02까지 값이 보이지만 DB 실측은 7/22가 마지막(이어받기 표시 보정).
  const row = mkRow("jjin.mood_", [["2026-07-22", 1854], ["2026-08-01", 1854], ["2026-08-02", 1854]]);
  const r = run([row], [["jjin.mood_", mkPost([["2026-07-22", 1854]])]]);
  assert.equal(r.stale, 1, "시트 기준으로 보면 놓친다 — DB 실측으로 봐야 잡힌다");
  assert.match(r.staleNotes[0], /마지막 실측 2026-07-22/);
});

test("메시지가 '이상 없음'만 말하지 않고 정체를 반드시 덧붙인다", () => {
  const row = mkRow("Ufo__green", [["2026-07-30", 3655]]);
  const { text, healthy } = formatAuditMessage(run([row], [["Ufo__green", mkPost([["2026-07-30", 3655]])]]));
  assert.match(text, /수식 이상 없음/);
  assert.match(text, /값 정체 1건/);
  assert.equal(healthy, false, "정체가 있으면 healthy가 아니어야 한다");
});

test("어제까지 실측이 들어왔으면 정체 아님", () => {
  const row = mkRow("정상글", [["2026-08-01", 100], ["2026-08-02", 120]]);
  const r = run([row], [["정상글", mkPost([["2026-08-01", 100], ["2026-08-02", 120]])]]);
  assert.equal(r.stale, 0);
  assert.equal(formatAuditMessage(r).healthy, true);
});

test("종료글은 실측이 멈춰 있어도 정체 아님(정상)", () => {
  const row = mkRow("종료글", [["2026-07-20", 500]]);
  const r = run([row], [["종료글", mkPost([["2026-07-20", 500]], { ended: "2026-08-03" })]]);
  assert.equal(r.stale, 0);
});

test("배너·피드·위성/온드는 매일 값이 없는 게 정상 — 제외", () => {
  for (const ct of ["바이럴 (배너)", "협찬 (피드)", "위성채널", "온드미디어"]) {
    assert.equal(isMetriclessChannel(ct), true, ct);
    const r = run([mkRow(ct, [["2026-07-20", 10]])], [[ct, mkPost([["2026-07-20", 10]], { channelType: ct })]]);
    assert.equal(r.stale, 0, ct);
  }
  assert.equal(isMetriclessChannel("바이럴 (영상)"), false);
});

test("갓 올린 글(어제 게시)은 아직 실측이 없어도 정체 아님", () => {
  const row: SheetAuditRow = { key: "신규", label: "신규", h: null, inc: null, dates: [] };
  const r = run([row], [["신규", mkPost([], { posted: "2026-08-02" })]]);
  assert.equal(r.stale, 0);
});

test("오래된 활성 글인데 실측이 한 번도 없으면 정체", () => {
  const row: SheetAuditRow = { key: "무측정", label: "무측정", h: null, inc: null, dates: [] };
  const r = run([row], [["무측정", mkPost([], { posted: "2026-07-01" })]]);
  assert.equal(r.stale, 1);
  assert.match(r.staleNotes[0], /마지막 실측 없음/);
});

test("DB에 없는 행은 판단하지 않는다(오탐 방지)", () => {
  const r = run([mkRow("미등록", [["2026-07-20", 10]])], []);
  assert.equal(r.stale, 0);
});
