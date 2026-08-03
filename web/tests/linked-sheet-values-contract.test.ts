import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.cwd(), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("private linked-sheet endpoint is fixed-range and cron-authenticated", () => {
  const route = read("web/app/api/ops/linked-sheet-values/route.ts");
  assert.match(route, /checkCronAuth\(req\)/);
  assert.match(route, /10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak/);
  assert.match(route, /A1:CZ3000/);
  assert.doesNotMatch(route, /searchParams/);

  const middleware = read("web/middleware.ts");
  assert.match(middleware, /\/api\/ops\/linked-sheet-values/);
});

test("sheet maintenance scripts use the authenticated reader", () => {
  for (const file of [
    "scripts/audit_linked_sheet_formulas.py",
    "scripts/report_blank_sheet_metrics.py",
    "scripts/reconcile_sheet_stat_mismatches.py",
  ]) {
    const source = read(file);
    assert.match(source, /fetch_linked_sheet_rows/);
    assert.doesNotMatch(source, /docs\.google\.com\/spreadsheets/);
  }
});

test("sheet workflows provide endpoint and cron authentication", () => {
  for (const file of [
    ".github/workflows/sheet-formula-audit.yml",
    ".github/workflows/report-blank-sheet-metrics.yml",
    ".github/workflows/reconcile-sheet-stat-mismatches.yml",
  ]) {
    const workflow = read(file);
    assert.match(workflow, /APP_URL:/);
    assert.match(workflow, /CRON_SECRET:/);
  }
});

test("daily increment report has primary and backup schedules enabled", () => {
  const workflow = read(".github/workflows/daily-increment-report.yml");
  assert.match(workflow, /^  schedule:/m);
  for (const hour of [3, 4, 5, 6]) {
    assert.match(workflow, new RegExp(`cron: "20 ${hour} \\* \\* \\*"`));
  }
});
