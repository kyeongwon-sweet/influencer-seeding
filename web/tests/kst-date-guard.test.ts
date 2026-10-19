// ⛔ 절대 규칙 — 업무 날짜는 KST. UTC 날짜 자르기를 레포 전체에서 막는다 (2026-10-19 사용자 지시).
//
// 🚨 반복 사고: UTC 타임스탬프를 `toISOString().slice(0,10)`·`created_at[:10]`·`date.today()`(러너=UTC)로
//    날짜화해 KST 00:00~08:59 기록이 '어제'가 됐다. 10-19 수집 사각 오탐 8건, 게시일 하루 밀림, 날짜 필터
//    버튼 어긋남 등. 사용자: "너무 자주 일어나. 다신 일어나지 않게 절대 규칙으로 못 박아."
//
// 이 테스트는 **웹·파이썬·Apps Script·워크플로** 전부를 훑는다. `npm test`(CI)와 **git pre-push 훅**에서 돈다.
// 날짜 문자열은 헬퍼로만 만든다:
//   · web:    web/lib/dateRule.ts  (todayKST·yesterdayKST·daysAgoKST·kstDateOf·addDaysToDate·utcDateOf)
//   · python: scripts/kst_dates.py (kst_today·kst_now·kst_date)
//   · Apps Script: 예외가 꼭 필요하면 그 줄에 `utc-date-ok: <이유>` (날짜만 더하는 계산 등). TS/Python엔 예외 표시 없음.

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = join(import.meta.dirname, "..", "..");
const SKIP = new Set(["node_modules", ".next", "dist", ".git", "__pycache__", "coverage", "out"]);

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

type Rule = { re: RegExp; why: string };

const JS_RULES: Rule[] = [
  { re: /toISOString\(\)\s*\.\s*(?:slice|substring|substr)\(\s*0\s*,\s*10\s*\)/, why: "toISOString() 날짜 = UTC → dateRule 헬퍼(todayKST/kstDateOf/addDaysToDate/utcDateOf)" },
  { re: /toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)/, why: "toISOString().split('T') = UTC 날짜 → kstDateOf" },
  { re: /toJSON\(\)\s*\.\s*(?:slice|substring)\(\s*0\s*,\s*10\s*\)/, why: "toJSON() 날짜 = UTC → kstDateOf" },
];
const PY_TS_FIELDS = "created_at|updated_at|inserted_at|requested_at|review_requested_at|not_found_last_at|started_at|finished_at|last_success_at|timestamp|createdAt|updatedAt|run_started_at";
const PY_RULES: Rule[] = [
  { re: /\butcnow\(/, why: "utcnow() → kst_now()" },
  { re: /\butcfromtimestamp\(/, why: "utcfromtimestamp() → kst_date(epoch)" },
  { re: /\bdate\.today\(\)/, why: "date.today() = 러너(UTC) 날짜 → kst_today()" },
  { re: /\bdatetime\.now\(\s*\)/, why: "datetime.now() = 러너(UTC) 시각 → kst_now()" },
  { re: /\bfromtimestamp\((?![^)]*\btz\b)/, why: "fromtimestamp() 시간대 없음 = 러너(UTC) → kst_date(epoch)" },
  { re: new RegExp(`(?:${PY_TS_FIELDS})\\b[^\\n]{0,60}?\\[\\s*:\\s*10\\s*\\]`), why: "타임스탬프[:10] = UTC 날짜 → kst_date()" },
];
const GS_RULES: Rule[] = [
  ...JS_RULES,
  { re: /formatDate\([^)]*['"](?:UTC|GMT|Etc\/UTC)['"]/, why: "Utilities.formatDate(…, 'UTC') → Session 시간대(Asia/Seoul) 사용" },
];
const SH_RULES: Rule[] = [
  { re: /\bdate\b[^\n|;]*\+%(?:F|Y-%m-%d)/, why: "date +%F 는 러너(UTC) 날짜 → 같은 줄에 TZ=Asia/Seoul" },
];

function scan(files: string[], rules: Rule[], opts: { allowMarker?: boolean; lineOk?: (line: string) => boolean } = {}): string[] {
  const hits: string[] = [];
  for (const f of files) {
    readFileSync(f, "utf8").split(/\r?\n/).forEach((line, i) => {
      if (opts.allowMarker && /utc-date-ok:\s*\S{2,}/.test(line)) return;
      if (opts.lineOk?.(line)) return;
      for (const r of rules) {
        if (r.re.test(line)) hits.push(`${relative(REPO, f).replace(/\\/g, "/")}:${i + 1} — ${r.why}\n    ${line.trim()}`);
      }
    });
  }
  return hits;
}

test("⛔ 웹 코드: UTC 날짜 자르기는 web/lib/dateRule.ts 밖에서 금지(예외 표시 없음)", () => {
  const files = [
    ...["app", "lib", "components", "scripts"].flatMap(d => walk(join(REPO, "web", d), /\.(ts|tsx|js|jsx|mjs)$/)),
    ...walk(join(REPO, "scripts"), /\.(js|mjs|cjs)$/),
  ].filter(f => !/[\\/]web[\\/]lib[\\/]dateRule\.ts$/.test(f));
  assert.deepEqual(scan(files, JS_RULES), [], "dateRule 헬퍼를 쓰세요");
});

test("⛔ 파이썬: UTC 날짜·러너 시각은 scripts/kst_dates.py 밖에서 금지(예외 표시 없음)", () => {
  const files = walk(join(REPO, "scripts"), /\.py$/)
    .filter(f => !/[\\/]test_[^\\/]*\.py$/.test(f) && !/[\\/]kst_dates\.py$/.test(f));
  assert.deepEqual(scan(files, PY_RULES), [], "kst_dates 헬퍼를 쓰세요");
});

test("⛔ Apps Script: UTC 날짜 금지(꼭 필요하면 그 줄에 'utc-date-ok: 이유')", () => {
  const files = [join(REPO, "Combined_Sheet_AppsScript.gs"), ...walk(join(REPO, "apps-script"), /\.(gs|js)$/)].filter(existsSync);
  assert.deepEqual(scan(files, GS_RULES, { allowMarker: true }), []);
});

test("⛔ 워크플로·셸: `date +%F` 는 같은 줄에 TZ=Asia/Seoul", () => {
  const files = [...walk(join(REPO, ".github", "workflows"), /\.ya?ml$/), ...walk(join(REPO, "scripts"), /\.sh$/)];
  assert.deepEqual(scan(files, SH_RULES, { lineOk: line => /TZ=Asia\/Seoul/.test(line) || /^\s*#/.test(line) }), []);
});

test("검사기가 실제로 사고 꼴을 잡는다(자기 검증 — 규칙이 조용히 무뎌지지 않게)", () => {
  const bad: Array<[Rule[], string]> = [
    [JS_RULES, "const today = new Date().toISOString().slice(0, 10);"],
    [JS_RULES, "posted_at = date.toISOString().split('T')[0];"],
    [PY_RULES, 'created = (p.get("created_at") or "")[:10]'],
    [PY_RULES, 'created = p["created_at"][:10]'],
    [PY_RULES, "today = date.today().isoformat()"],
    [PY_RULES, 'stamp = datetime.now().strftime("%Y%m%d")'],
    [PY_RULES, "d = datetime.utcfromtimestamp(ts)"],
    [PY_RULES, "d = datetime.fromtimestamp(ts)"],
    [GS_RULES, 'return Utilities.formatDate(d, "GMT", "yyyy-MM-dd");'],
    [SH_RULES, "today=$(date +%F)"],
  ];
  for (const [rules, line] of bad) assert.ok(rules.some(r => r.re.test(line)), `못 잡음: ${line}`);
  const good: Array<[Rule[], string]> = [
    [PY_RULES, 'posted = str(p.get("posted_at") or "")[:10]'],   // posted_at 은 날짜 컬럼
    [PY_RULES, "d = datetime.fromtimestamp(ts, tz=timezone.utc)"],
    [PY_RULES, 'stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")'],
  ];
  for (const [rules, line] of good) assert.ok(!rules.some(r => r.re.test(line)), `오탐: ${line}`);
});

test("pre-push 훅이 이 검사를 돌린다(배포 전에 막힌다 — main push = 즉시 배포)", () => {
  const hook = readFileSync(join(REPO, ".githooks", "pre-push"), "utf8");
  assert.match(hook, /kst-date-guard\.test\.ts/);
});
