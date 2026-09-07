#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SCRIPT_ID = "1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn";
const REPAIR_FUNCTION = "repairPostedAt20260907";
const SIGNATURE = "posted-at-25-5-mag-2026-09-07";

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

async function execute(token, functionName, parameters = []) {
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${SCRIPT_ID}:run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ function: functionName, parameters, devMode: true }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(`Apps Script ${functionName} failed (${response.status}): ${JSON.stringify(payload.error ?? payload)}`);
  }
  return payload.response?.result;
}

function assertRepairResult(result, expectedStatus) {
  if (!result?.ok || result.matched !== 1 || result.key !== "ig:DclKlzuJof6" ||
      result.account !== "25.5_mag" || result.expected_posted_at !== "2026-08-28" ||
      !expectedStatus.includes(result.status)) {
    throw new Error(`Unsafe repair result: ${JSON.stringify(result)}`);
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const token = await accessToken();
  const dryRun = await execute(token, REPAIR_FUNCTION, [SIGNATURE, false]);
  assertRepairResult(dryRun, ["DRY_RUN", "ALREADY_DONE"]);
  console.log(JSON.stringify({ mode: apply ? "apply-ready" : "dry-run", ...dryRun }, null, 2));
  if (!apply) return;

  const backupDir = path.resolve("scratchpad");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "_").replace("Z", "Z");
  const backupPath = path.join(backupDir, `posted_at_25_5_mag_backup_20260907_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    created_at: new Date().toISOString(),
    policy: "URL-key matched single-cell posted_at correction; no metric writes",
    rollback: "restore posted_at=2026-08-30 only if ig:DclKlzuJof6 is still a unique 25.5_mag row",
    before: dryRun,
  }, null, 2));

  const applied = await execute(token, REPAIR_FUNCTION, [SIGNATURE, true]);
  assertRepairResult(applied, ["OK", "ALREADY_DONE"]);
  const synced = await execute(token, "syncAll");
  if (synced !== true) throw new Error(`syncAll failed: ${JSON.stringify(synced)}`);
  const verified = await execute(token, "verifyPostedAt20260907");
  if (!verified?.ok || verified.status !== "VERIFIED" || verified.db_matches !== 1 ||
      verified.sheet_posted_at !== "2026-08-28" || verified.db_posted_at !== "2026-08-28") {
    throw new Error(`Post-sync verification failed: ${JSON.stringify(verified)}`);
  }
  console.log(JSON.stringify({ applied: true, backup: backupPath, result: applied, syncAll: synced, verify: verified }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
