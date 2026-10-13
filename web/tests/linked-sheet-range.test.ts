// 연동시트 읽기 범위 — 행 상한 금지 계약 (2026-10-13 추가).
//
// 🚨 실사고: 연동시트(gid=1937186871)를 읽는 경로들이 `A1:CZ3000`·`A1:ZZ5000`·`A1:CZ5000` 처럼
//    행·열 상한을 박아 두었다. 시트가 5,001행·FH열까지 자라자
//      · 매일 수식 감사·배너 도달수 동기화가 5001행부터(=가장 최신 행부터) 조용히 빠지기 시작했고
//      · sheet-integrity 는 1,993행과 CZ 이후 날짜열을 통째로 못 보고 있었다.
//    에러 없이 '완료'로 끝나므로 아무도 몰랐다. 최신 행이 가장 문제 나기 쉬운 행이라 최악의 방향으로 잘렸다.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { LINKED_SHEET_FULL_RANGE, LINKED_SHEET_MAX_COLUMNS, LINKED_SHEET_COLUMN_WARN } from "../lib/google-sheets.ts";

const ROOT = join(import.meta.dirname, "..");
const LINKED_GID = "1937186871";
// 행 상한이 있어도 되는 예외: 헤더 1행만 읽는 호출, 날짜가 박힌 일회성 복구 경로.
const ALLOWED_ROW_BOUNDED = new Set(['"A1:ZZ1"']);
const ONE_OFF_REPAIR_ROUTES = new Set(["app/api/ops/repair-c15-costs-20260915/route.ts"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("공용 범위는 행 상한이 없다", () => {
  assert.match(LINKED_SHEET_FULL_RANGE, /^A1:[A-Z]+$/, "끝에 행 번호가 붙으면 시트가 자랄 때 최신 행부터 잘린다");
  assert.ok(LINKED_SHEET_COLUMN_WARN < LINKED_SHEET_MAX_COLUMNS, "열 상한 소진 전에 경고가 먼저 나야 한다");
});

test("🚨 연동시트를 읽는 경로는 행 상한이 박힌 범위를 쓰지 않는다(사고 재현 방지)", () => {
  // 같은 파일이 다른 탭(가격표·정산 탭 등)도 읽으므로, **연동시트 gid 변수로 읽는 호출**만 본다.
  const offenders: string[] = [];
  for (const file of walk(join(ROOT, "app"))) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const src = readFileSync(file, "utf8");
    if (ONE_OFF_REPAIR_ROUTES.has(rel)) continue;
    const gidVar = src.match(new RegExp(`const (\\w*GID) = ${LINKED_GID};`))?.[1];
    if (!gidVar) continue;
    // ① gid 변수와 함께 리터럴 범위를 직접 넘기는 호출
    for (const m of src.matchAll(new RegExp(`fetchSheetTab\\w*\\(\\s*\\w+,\\s*${gidVar}\\s*,\\s*("A1:[A-Z]+\\d+")`, "g"))) {
      if (!ALLOWED_ROW_BOUNDED.has(m[1])) offenders.push(`${rel}: ${m[1]}`);
    }
    // ② 연동시트용 SHEET_RANGE 상수
    const sheetRange = src.match(/const SHEET_RANGE = ([^;]+);/)?.[1];
    if (sheetRange && sheetRange.trim() !== "LINKED_SHEET_FULL_RANGE") offenders.push(`${rel}: SHEET_RANGE = ${sheetRange}`);
  }
  assert.deepEqual(offenders, [], "연동시트를 행 상한 범위로 읽는 곳이 있다 — LINKED_SHEET_FULL_RANGE 를 쓰라");
});

test("검사가 실제로 사고 꼴을 잡는다(자기 검증) — 옛 sheet-integrity 코드를 넣으면 걸려야 한다", () => {
  const legacy = `const GID = ${LINKED_GID};\nvalues = await fetchSheetTabValues(SHEET_ID, GID, "A1:CZ3000");`;
  const gidVar = legacy.match(new RegExp(`const (\\w*GID) = ${LINKED_GID};`))?.[1];
  const hits = [...legacy.matchAll(new RegExp(`fetchSheetTab\\w*\\(\\s*\\w+,\\s*${gidVar}\\s*,\\s*("A1:[A-Z]+\\d+")`, "g"))].map((m) => m[1]);
  assert.deepEqual(hits, ['"A1:CZ3000"']);
});

test("사고 당시 상한을 쓰던 네 경로가 공용 범위를 쓴다", () => {
  for (const rel of [
    "app/api/admin/sheet-integrity/route.ts",
    "app/api/sponsored-posts/formula-audit/route.ts",
    "app/api/sponsored-posts/banner-reach-sync/route.ts",
    "app/api/ops/linked-sheet-values/route.ts",
  ]) {
    assert.match(readFileSync(join(ROOT, rel), "utf8"), /LINKED_SHEET_FULL_RANGE/, rel);
  }
});

test("수식 감사가 열 상한 소진을 미리 경고한다", () => {
  const src = readFileSync(join(ROOT, "app/api/sponsored-posts/formula-audit/route.ts"), "utf8");
  assert.match(src, /header\.length >= LINKED_SHEET_COLUMN_WARN/);
  assert.match(src, /\[columnAlert, headerAlert, text\]\.filter\(Boolean\)\.join\("\\n\\n"\)/);
});
