import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  EXPORT_STATS_HEARTBEAT_SERVICE,
  parseExportStatsHeartbeatInput,
} from "../lib/automation-heartbeat.ts";

const route = readFileSync(
  new URL("../app/api/ops/automation-heartbeat/route.ts", import.meta.url),
  "utf8",
);
const appsScript = readFileSync(
  new URL("../../Combined_Sheet_AppsScript.gs", import.meta.url),
  "utf8",
);
const middleware = readFileSync(
  new URL("../middleware.ts", import.meta.url),
  "utf8",
);

test("exportStats heartbeat accepts a measured completion summary", () => {
  const parsed = parseExportStatsHeartbeatInput({
    job: "exportStats",
    written_date: "2026-09-06",
    cells_written: 820,
    blank_cells_filled: 819,
    auto_cells_corrected: 0,
    formula_rows_written: 3532,
    added_date_columns: 1,
    source: "dailyAuto",
    write_mode: "full",
    import_status: "OK",
  });
  assert.equal(EXPORT_STATS_HEARTBEAT_SERVICE, "apps-script-export-stats");
  assert.equal(parsed.written_date, "2026-09-06");
  assert.equal(parsed.cells_written, 820);
});

test("exportStats heartbeat rejects invalid dates, jobs, and counters", () => {
  const valid = {
    job: "exportStats",
    written_date: "2026-09-06",
    cells_written: 0,
    blank_cells_filled: 0,
    auto_cells_corrected: 0,
    formula_rows_written: 0,
    added_date_columns: 0,
    source: "manual",
    write_mode: "full",
    import_status: "OK",
  };
  assert.throws(() => parseExportStatsHeartbeatInput({ ...valid, job: "importStats" }), /job must be exportStats/);
  assert.throws(() => parseExportStatsHeartbeatInput({ ...valid, written_date: "2026-02-30" }), /written_date/);
  assert.throws(() => parseExportStatsHeartbeatInput({ ...valid, cells_written: -1 }), /cells_written/);
  assert.throws(() => parseExportStatsHeartbeatInput({ ...valid, write_mode: "overwrite" }), /write_mode/);
});

test("heartbeat API is authenticated and uses an idempotent marker in the existing jobs table", () => {
  assert.match(route, /checkCronAuth\(req\) !== "ok"/);
  assert.match(route, /\.from\("jobs"\)/);
  assert.match(route, /\.contains\("payload", \{/);
  assert.match(route, /ops_marker: EXPORT_STATS_HEARTBEAT_SERVICE/);
  assert.match(route, /existing\.data\?\.id/);
  assert.match(route, /EXPORT_STATS_HEARTBEAT_SERVICE/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(middleware, /\/api\/ops\/automation-heartbeat\(\.\*\)/);
});

test("exportStats records heartbeat only after the write summary is complete", () => {
  assert.match(appsScript, /EXPORT_STATS_HEARTBEAT_URL/);
  const exportStart = appsScript.indexOf("function exportStatsWithOptions_(options)");
  const exportEnd = appsScript.indexOf("// ═══════════════════════════════════════════════════════════════", exportStart + 10);
  const body = appsScript.slice(exportStart, exportEnd);
  const writeIndex = body.indexOf("dateKeyWrites++");
  const heartbeatIndex = body.indexOf("markExportStatsSuccess_");
  assert.ok(writeIndex >= 0 && heartbeatIndex > writeIndex);
  assert.match(body, /writtenDate: incrementTargetDate/);
  assert.match(body, /cellsWritten: dateKeyWrites/);
  assert.match(body, /if \(!formulaOnly\)/);
  assert.match(body, /writeMode: preserveExistingMetrics \? "fill_blanks_only" : "full"/);
  assert.match(body, /importStatus: importGateStatus/);
});
