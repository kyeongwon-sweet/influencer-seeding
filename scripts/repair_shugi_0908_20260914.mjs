#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SCRIPT_ID = "1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn";
const REPAIR_FUNCTION = "repairShugi0908Cell20260914";
const SIGNATURE = "shugi-0908-play-2026-09-14";

function claspTokenRecord(credentials) {
  const record = credentials?.tokens?.default ?? credentials?.tokens;
  if (!record?.client_id || !record?.client_secret || !record?.refresh_token) {
    throw new Error("The clasp credential file has no refreshable default token");
  }
  return record;
}

async function accessToken() {
  const credentialsPath = path.join(process.env.USERPROFILE ?? "", ".clasprc.json");
  const token = claspTokenRecord(JSON.parse(fs.readFileSync(credentialsPath, "utf8")));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: token.client_id,
      client_secret: token.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`clasp OAuth refresh failed (${response.status})`);
  return (await response.json()).access_token;
}

async function execute(token, parameters) {
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${SCRIPT_ID}:run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ function: REPAIR_FUNCTION, parameters, devMode: true }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(`Apps Script ${REPAIR_FUNCTION} failed (${response.status}): ${JSON.stringify(payload.error ?? payload)}`);
  }
  return payload.response?.result;
}

function assertResult(result, expectedStatuses) {
  if (!result?.ok || result.matched !== 1 || result.key !== "ig:DdBU6JmhltN" ||
      result.account !== "슈기" || result.date !== "2026-09-08" ||
      result.expectedValue !== 413000 || !expectedStatuses.includes(result.status)) {
    throw new Error(`Unsafe repair result: ${JSON.stringify(result)}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const token = await accessToken();
  const before = await execute(token, [SIGNATURE, false]);
  assertResult(before, ["DRY_RUN", "ALREADY_DONE"]);
  console.log(JSON.stringify({ mode: apply ? "apply-ready" : "dry-run", ...before }, null, 2));
  if (!apply || before.status === "ALREADY_DONE") return;
  if (Number(before.value) !== 463731) throw new Error(`Unexpected old value: ${before.value}`);

  const backupDir = path.resolve("scratchpad");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "_").replace("Z", "Z");
  const backupPath = path.join(backupDir, `shugi_0908_sheet_backup_20260914_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    created_at: new Date().toISOString(),
    policy: "URL-key matched single metric-cell correction; H/I formulas and adjacent dates preserved",
    rollback: "restore the backed-up value only if ig:DdBU6JmhltN remains unique and the 2026-09-08 cell is unchanged since this repair",
    before,
  }, null, 2));

  const applied = await execute(token, [SIGNATURE, true]);
  assertResult(applied, ["OK", "ALREADY_DONE"]);
  const verified = await execute(token, [SIGNATURE, false]);
  assertResult(verified, ["ALREADY_DONE"]);
  if (Number(verified.value) !== 413000 || verified.cumulativeFormula !== before.cumulativeFormula ||
      verified.incrementFormula !== before.incrementFormula || verified.previousValue !== before.previousValue ||
      verified.nextValue !== before.nextValue) {
    throw new Error(`Post-write verification failed: ${JSON.stringify(verified)}`);
  }
  console.log(JSON.stringify({ applied: true, backup: backupPath, result: applied, verify: verified }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
