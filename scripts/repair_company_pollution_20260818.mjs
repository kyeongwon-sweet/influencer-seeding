#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonAccount } from "../web/lib/companyMap.ts";
import { postIdentityKey } from "../web/lib/url-utils.ts";

const SCRIPT_ID = "1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn";
const SCRIPT_FUNCTION = "repairCompanyPollution20260818";
const SIGNATURE = "company-pollution-2026-08-18";
const EXPECTED_ROWS = 313;
const EXPECTED_DISTRIBUTION = {
  "(빈칸)": 177,
  "굿띵투유": 47,
  "유머패밀리": 32,
  "동후작가": 25,
  "아택": 14,
  "루나앤코코": 11,
  "업크루": 6,
  "후마니": 1,
};

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function decodeEnvValue(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1).replace(/\\n/g, "\n");
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function loadEnvFile(envPath) {
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    if (!process.env[key]) process.env[key] = decodeEnvValue(line.slice(equals + 1));
  }
}

function requiredEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function equalNullable(left, right) {
  return String(left ?? "").trim() === String(right ?? "").trim();
}

function distribution(rows, field) {
  const counts = new Map();
  for (const row of rows) {
    const key = String(row[field] ?? "").trim() || "(빈칸)";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")));
}

function assertDistribution(actual) {
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_DISTRIBUTION)) {
    throw new Error(`Unexpected source distribution: ${JSON.stringify(actual)}`);
  }
}

function validateSource(source) {
  if (!Array.isArray(source) || source.length !== EXPECTED_ROWS) {
    throw new Error(`Expected ${EXPECTED_ROWS} source rows, got ${source?.length ?? "invalid"}`);
  }
  const ids = new Set();
  const keys = new Set();
  for (const item of source) {
    const id = String(item.id ?? "").trim();
    const key = postIdentityKey(String(item.url ?? ""));
    if (!id || !key || !String(item.account_name ?? "").trim()) throw new Error(`Invalid source item: ${JSON.stringify(item)}`);
    if (ids.has(id)) throw new Error(`Duplicate source id: ${id}`);
    if (keys.has(key)) throw new Error(`Duplicate source key: ${key}`);
    ids.add(id);
    keys.add(key);
  }
  assertDistribution(distribution(source, "new_company"));
}

function claspTokenRecord(credentials) {
  const record = credentials?.tokens?.default ?? credentials?.tokens;
  if (!record?.client_id || !record?.client_secret || !record?.refresh_token) {
    throw new Error("The clasp credential file has no refreshable default token");
  }
  return record;
}

async function refreshClaspAccessToken(credentialsPath) {
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const token = claspTokenRecord(credentials);
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
  if (!response.ok) throw new Error(`clasp OAuth refresh failed (${response.status}): ${await response.text()}`);
  return (await response.json()).access_token;
}

async function runAppsScript(accessToken, apply, source) {
  const rows = source.map(item => ({
    id: String(item.id),
    url: String(item.url),
    account_name: String(item.account_name),
    old_company: item.old_company ?? null,
    new_company: item.new_company ?? null,
  }));
  const response = await fetch(`https://script.googleapis.com/v1/scripts/${SCRIPT_ID}:run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      function: SCRIPT_FUNCTION,
      parameters: [{ signature: SIGNATURE, apply, rows }],
      devMode: true,
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Apps Script execution failed (${response.status}): ${JSON.stringify(payload)}`);
  if (payload.error) throw new Error(`Apps Script function failed: ${JSON.stringify(payload.error)}`);
  const result = payload.response?.result;
  if (!result?.ok || result.matched !== EXPECTED_ROWS || result.company_column !== "N") {
    throw new Error(`Apps Script returned an unsafe result: ${JSON.stringify(result)}`);
  }
  assertDistribution(result.distribution);
  return result;
}

function supabaseHeaders(extra = {}) {
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function fetchDbRows(ids) {
  const base = requiredEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  const rows = [];
  for (let index = 0; index < ids.length; index += 80) {
    const chunk = ids.slice(index, index + 80).join(",");
    const query = `id=in.(${chunk})&select=id,url,account_name,company_name,channel_type,manual_fields`;
    const response = await fetch(`${base}/rest/v1/sponsored_posts?${query}`, { headers: supabaseHeaders() });
    if (!response.ok) throw new Error(`DB read failed (${response.status}): ${await response.text()}`);
    rows.push(...await response.json());
  }
  return rows;
}

function buildDbPlan(source, dbRows) {
  const byId = new Map(dbRows.map(row => [String(row.id), row]));
  const errors = [];
  const plan = source.map(item => {
    const db = byId.get(String(item.id));
    if (!db) {
      errors.push(`DB row missing: ${item.id}`);
      return null;
    }
    const sourceKey = postIdentityKey(String(item.url));
    if (postIdentityKey(String(db.url ?? "")) !== sourceKey) errors.push(`DB URL mismatch: ${item.id}`);
    if (canonAccount(db.account_name) !== canonAccount(item.account_name)) errors.push(`DB account mismatch: ${item.id}`);
    if (!equalNullable(db.company_name, item.old_company) && !equalNullable(db.company_name, item.new_company)) {
      errors.push(`Unexpected DB company: ${item.id}`);
    }
    return {
      ...item,
      db_company_name: db.company_name ?? null,
      db_manual_fields: Array.isArray(db.manual_fields) ? db.manual_fields : [],
    };
  }).filter(Boolean);
  if (dbRows.length !== EXPECTED_ROWS) errors.push(`Expected ${EXPECTED_ROWS} DB rows, got ${dbRows.length}`);
  if (errors.length) throw new Error(`DB safety checks failed (${errors.length}):\n${errors.slice(0, 30).join("\n")}`);
  return plan;
}

async function updateDbRows(rows) {
  const base = requiredEnv("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
  for (let index = 0; index < rows.length; index += 20) {
    await Promise.all(rows.slice(index, index + 20).map(async row => {
      const manualFields = row.db_manual_fields.filter(field => field !== "company_name");
      const response = await fetch(`${base}/rest/v1/sponsored_posts?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: supabaseHeaders({ "Content-Type": "application/json", Prefer: "return=minimal" }),
        body: JSON.stringify({ company_name: row.new_company ?? null, manual_fields: manualFields }),
      });
      if (!response.ok) throw new Error(`DB update failed id=${row.id} (${response.status}): ${await response.text()}`);
    }));
  }
}

async function main() {
  const sourcePath = argValue("--source");
  const envPath = argValue("--env-file");
  const claspCredentials = argValue("--clasp-credentials") ?? path.join(process.env.USERPROFILE ?? "", ".clasprc.json");
  const backupDir = argValue("--backup-dir") ?? path.resolve("scratchpad");
  const apply = hasArg("--apply");
  if (!sourcePath || !envPath) {
    throw new Error("Usage: --source <json> --env-file <env> [--clasp-credentials <json>] [--backup-dir <dir>] [--apply]");
  }

  loadEnvFile(envPath);
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  validateSource(source);
  const dbRows = await fetchDbRows(source.map(row => String(row.id)));
  const dbPlan = buildDbPlan(source, dbRows);
  const dbChanges = dbPlan.filter(row =>
    !equalNullable(row.db_company_name, row.new_company)
    || row.db_manual_fields.includes("company_name"),
  );
  const accessToken = await refreshClaspAccessToken(claspCredentials);
  const sheetDryRun = await runAppsScript(accessToken, false, source);

  console.log(JSON.stringify({
    mode: apply ? "apply-ready" : "dry-run",
    source_rows: source.length,
    sheet: sheetDryRun,
    db_matched: dbPlan.length,
    db_changes: dbChanges.length,
    expected_distribution: distribution(source, "new_company"),
  }, null, 2));
  if (!apply) return;

  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "");
  const backupPath = path.join(backupDir, `company_pollution_live_backup_${stamp}.json`);
  fs.writeFileSync(backupPath, JSON.stringify({
    created_at: new Date().toISOString(),
    source,
    db_before: dbPlan,
    sheet_dry_run: sheetDryRun,
  }, null, 2));

  const sheetApply = await runAppsScript(accessToken, true, source);
  if (sheetApply.verified !== EXPECTED_ROWS || sheetApply.written !== sheetDryRun.changes) {
    throw new Error(`Sheet apply verification failed: ${JSON.stringify(sheetApply)}`);
  }
  await updateDbRows(dbChanges);

  const verifyDbRows = await fetchDbRows(source.map(row => String(row.id)));
  const verifyPlan = buildDbPlan(source, verifyDbRows);
  const badDb = verifyPlan.filter(row => !equalNullable(row.db_company_name, row.new_company));
  const lockedDb = verifyPlan.filter(row => row.db_manual_fields.includes("company_name"));
  const verifySheet = await runAppsScript(accessToken, false, source);
  if (badDb.length || lockedDb.length || verifySheet.changes !== 0) {
    throw new Error(`Post-write verification failed: sheet=${verifySheet.changes}, db=${badDb.length}, locks=${lockedDb.length}`);
  }

  console.log(JSON.stringify({
    applied: true,
    backup: backupPath,
    sheet_updated: sheetApply.written,
    sheet_verified: sheetApply.verified,
    sheet_backup: sheetApply.backup_sheet,
    db_updated: dbChanges.length,
    db_verified: verifyPlan.length,
    remaining_sheet_mismatch: verifySheet.changes,
    remaining_db_mismatch: badDb.length,
    remaining_company_locks: lockedDb.length,
  }, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
