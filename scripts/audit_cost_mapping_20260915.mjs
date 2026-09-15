#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const SCRIPT_ID = "1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn";
const FUNCTION = "auditCostMapping20260915";
const SIGNATURE = "cost-mapping-audit-2026-09-15";

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

async function main() {
  const token = await accessToken();
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${SCRIPT_ID}:run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ function: FUNCTION, parameters: [SIGNATURE], devMode: true }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(`Apps Script ${FUNCTION} failed (${response.status}): ${JSON.stringify(payload.error ?? payload)}`);
  }
  const result = payload.response?.result;
  if (!result?.ok || !Array.isArray(result.targets) || result.targets.length !== 11) {
    throw new Error(`Unsafe audit result: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
