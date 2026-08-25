#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SCRIPT_ID = "1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn";
const SCRIPT_FUNCTION = "repairMagazineCarouselBanner20260825";
const SIGNATURE = "magazine-carousel-banner-2026-08-25";
const EXPECTED = 4;

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

async function execute(token, apply) {
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${SCRIPT_ID}:run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      function: SCRIPT_FUNCTION,
      parameters: [{ signature: SIGNATURE, apply }],
      devMode: true,
    }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(`Apps Script execution failed (${response.status}): ${JSON.stringify(payload.error ?? payload)}`);
  }
  const result = payload.response?.result;
  if (!result?.ok || result.matched !== EXPECTED || result.targets?.length !== EXPECTED) {
    throw new Error(`Unsafe Apps Script result: ${JSON.stringify(result)}`);
  }
  return result;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const token = await accessToken();
  const dryRun = await execute(token, false);
  console.log(JSON.stringify({ mode: apply ? "apply-ready" : "dry-run", ...dryRun }, null, 2));
  if (!apply) return;
  if (![0, EXPECTED].includes(dryRun.changes)) {
    throw new Error(`Expected ${EXPECTED} pending sheet changes or an idempotent rerun, got ${dryRun.changes}`);
  }

  const backupDir = path.resolve("scratchpad");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, "magazine_carousel_banner_backup_20260825.json");
  fs.writeFileSync(backupPath, JSON.stringify({
    created_at: new Date().toISOString(),
    policy: "all banners use reach_count",
    rollback: "restore old_type in sheet and move each 2026-08-10 value from reach_count back to play_count",
    before: dryRun,
  }, null, 2));

  const applied = await execute(token, true);
  if (applied.written !== dryRun.changes || applied.verified !== EXPECTED
    || applied.bulk?.locked_drift !== 0 || applied.stats?.banner_reach_inserted !== EXPECTED
    || applied.stats?.inserted !== 0) {
    throw new Error(`Apply verification failed: ${JSON.stringify(applied)}`);
  }
  const verify = await execute(token, false);
  if (verify.changes !== 0) throw new Error(`Post-apply sheet verification failed: ${JSON.stringify(verify)}`);
  console.log(JSON.stringify({ applied: true, backup: backupPath, result: applied, verify }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
