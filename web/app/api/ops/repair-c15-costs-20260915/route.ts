import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { fetchSheetTabFormulas, fetchSheetTabValues, updateSheetTabValues } from "@/lib/google-sheets";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const SHEET_ID = "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak";
const SHEET_GID = 1937186871;
const SHEET_RANGE = "A1:CZ5000";
const PRICING_GID = 1649102171;
const PRICING_RANGE = "A1:H500";
const EXPECTED_COST = 60000;
const SIGNATURE = "repair-c15-costs-2026-09-15";
const BACKUP_MARKER = "c15_cost_repair_20260915_backup";

const TARGETS = [
  { label: "힐링하고 가세요", key: "tt:7675271025176661269" },
  { label: "wikitrip", key: "ig:DcQQ2npCWJL" },
  { label: "happy__pyeong", key: "ig:DcakMZokd2s" },
  { label: "맨투맨 스튜디오(틱톡)", key: "tt:7681587607020506389" },
] as const;

function normalizeHeader(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function headerIndex(headers: unknown[], name: string): number {
  const index = headers.findIndex((value) => normalizeHeader(value) === normalizeHeader(name));
  if (index < 0) throw new Error(`필수 시트 헤더가 없습니다: ${name}`);
  return index;
}

function cell(row: unknown[], index: number): unknown {
  return index < row.length ? row[index] : "";
}

function parseCost(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(number) ? Math.round(number) : null;
}

function accountKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, "").replace(/_+/g, "_");
}

function linkKey(value: unknown): string {
  const text = String(value ?? "").trim();
  const instagram = text.match(/instagram\.com\/(?:[^/?#]+\/)?(?:p|reel|reels|tv)\/([\w-]+)/i);
  if (instagram) return `ig:${instagram[1]}`;
  const tiktok = text.match(/tiktok\.com\/(?:@[^/]+\/)?(?:video|photo)\/(\d+)/i);
  if (tiktok) return `tt:${tiktok[1]}`;
  return "";
}

function colLetter(index: number): string {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

type DbPost = {
  id: string;
  normalized_key: string;
  url: string;
  account_name: string | null;
  channel_type: string | null;
  cost: number | null;
  manual_fields: unknown;
};

async function inspect() {
  const [rows, formulas, pricingRows] = await Promise.all([
    fetchSheetTabValues(SHEET_ID, SHEET_GID, SHEET_RANGE),
    fetchSheetTabFormulas(SHEET_ID, SHEET_GID, SHEET_RANGE),
    fetchSheetTabValues(SHEET_ID, PRICING_GID, PRICING_RANGE),
  ]);
  if (!rows.length || !pricingRows.length) throw new Error("연동시트 또는 단가표가 비어 있습니다.");

  const headers = rows[0];
  const columns = {
    url: headerIndex(headers, "게시물URL"),
    account: headerIndex(headers, "채널명"),
    channelType: headerIndex(headers, "채널분류"),
    cost: headerIndex(headers, "비용"),
  };
  const targetMap = new Map(TARGETS.map((target) => [target.key.toLowerCase(), target]));
  const matches = new Map<string, Array<{ row: number; values: unknown[] }>>();
  const history = new Map<string, Set<number>>();
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index];
    const key = linkKey(cell(row, columns.url)).toLowerCase();
    if (targetMap.has(key)) {
      const found = matches.get(key) ?? [];
      found.push({ row: index + 1, values: row });
      matches.set(key, found);
    }
    const cost = parseCost(cell(row, columns.cost));
    if (cost != null && cost > 0) {
      const account = accountKey(cell(row, columns.account));
      const values = history.get(account) ?? new Set<number>();
      values.add(cost);
      history.set(account, values);
    }
  }

  const pricing = new Map<string, Set<number>>();
  for (const row of pricingRows.slice(1)) {
    if (String(cell(row, 2)).trim() !== "배너") continue;
    const cost = parseCost(cell(row, 3));
    if (cost == null || cost <= 0) continue;
    const key = accountKey(cell(row, 0));
    const values = pricing.get(key) ?? new Set<number>();
    values.add(cost);
    pricing.set(key, values);
  }

  const supabase = getServerSupabase();
  const dbResults = await Promise.all(TARGETS.map(async (target) => {
    const contentId = target.key.slice(target.key.indexOf(":") + 1);
    const { data, error } = await supabase
      .from("sponsored_posts")
      .select("id, normalized_key, url, account_name, channel_type, cost, manual_fields")
      .ilike("url", `%${contentId}%`);
    if (error) throw new Error(`DB 조회 실패(${target.label}): ${error.message}`);
    const key = target.key.toLowerCase();
    return ((data ?? []) as DbPost[]).filter((post) => (
      String(post.normalized_key ?? "").toLowerCase() === key
      || linkKey(post.url).toLowerCase() === key
    ));
  }));
  const dbByKey = new Map<string, DbPost[]>();
  for (let index = 0; index < TARGETS.length; index += 1) {
    dbByKey.set(TARGETS[index].key.toLowerCase(), dbResults[index]);
  }

  const inspected = TARGETS.map((target) => {
    const key = target.key.toLowerCase();
    const sheetMatches = matches.get(key) ?? [];
    const dbMatches = dbByKey.get(key) ?? [];
    const row = sheetMatches[0]?.values ?? [];
    const formulaRow = sheetMatches.length === 1 ? (formulas[sheetMatches[0].row - 1] ?? []) : [];
    const account = accountKey(cell(row, columns.account));
    const evidence = new Set<number>([
      ...(history.get(account) ?? []),
      ...(pricing.get(account) ?? []),
    ]);
    const sheetCost = parseCost(cell(row, columns.cost));
    const sheetCostFormula = String(cell(formulaRow, columns.cost) ?? "").trim();
    const dbCost = dbMatches.length === 1 ? Number(dbMatches[0].cost ?? 0) : null;
    const safe = sheetMatches.length === 1
      && dbMatches.length === 1
      && evidence.size === 1
      && evidence.has(EXPECTED_COST)
      && (sheetCost === 0 || sheetCost === EXPECTED_COST)
      && (sheetCost === EXPECTED_COST || !sheetCostFormula.startsWith("="))
      && (dbCost === 0 || dbCost === EXPECTED_COST);
    return {
      label: target.label,
      normalizedKey: target.key,
      sheetMatchCount: sheetMatches.length,
      sheetRow: sheetMatches[0]?.row ?? null,
      sheetUrl: cell(row, columns.url),
      accountName: cell(row, columns.account),
      channelType: cell(row, columns.channelType),
      sheetCost,
      sheetCostFormula,
      evidenceCosts: [...evidence].sort((a, b) => a - b),
      dbMatchCount: dbMatches.length,
      dbPost: dbMatches[0] ?? null,
      safe,
    };
  });
  return { rows, columns, inspected };
}

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") return response({ error: "Unauthorized" }, 401);
  try {
    const { inspected } = await inspect();
    return response({ dry_run: true, expectedCount: TARGETS.length, rows: inspected });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") return response({ error: "Unauthorized" }, 401);
  let body: { signature?: string; expectedCount?: number };
  try {
    body = await req.json();
  } catch {
    return response({ error: "JSON body required" }, 400);
  }
  if (body.signature !== SIGNATURE || body.expectedCount !== TARGETS.length) {
    return response({ error: "Invalid repair signature or expectedCount" }, 400);
  }

  try {
    const before = await inspect();
    if (before.inspected.length !== TARGETS.length || before.inspected.some((row) => !row.safe)) {
      return response({ error: "Preflight failed", rows: before.inspected }, 409);
    }

    const supabase = getServerSupabase();
    const { data: backup, error: backupError } = await supabase
      .from("jobs")
      .insert({
        type: "monitoring",
        status: "done",
        payload: {
          ops_marker: BACKUP_MARKER,
          created_at: new Date().toISOString(),
          expected_cost: EXPECTED_COST,
          rows: before.inspected,
        },
      })
      .select("id")
      .single();
    if (backupError || !backup?.id) throw new Error(`백업 기록 실패: ${backupError?.message ?? "id 없음"}`);

    const costColumn = colLetter(before.columns.cost);
    const sheetUpdates = before.inspected
      .filter((row) => row.sheetCost !== EXPECTED_COST)
      .map((row) => ({ range: `${costColumn}${row.sheetRow}`, values: [[EXPECTED_COST]] }));
    const sheetWrite = await updateSheetTabValues(SHEET_ID, SHEET_GID, sheetUpdates);

    const afterSheet = await inspect();
    if (afterSheet.inspected.some((row) => !row.safe || row.sheetCost !== EXPECTED_COST)) {
      throw new Error("시트 사후검증 실패");
    }

    for (const row of afterSheet.inspected) {
      if (Number(row.dbPost?.cost ?? 0) === EXPECTED_COST) continue;
      const { error } = await supabase
        .from("sponsored_posts")
        .update({ cost: EXPECTED_COST })
        .eq("id", row.dbPost!.id);
      if (error) throw new Error(`DB 비용 갱신 실패(${row.label}): ${error.message}`);
    }

    const verified = await inspect();
    if (verified.inspected.some((row) => row.sheetCost !== EXPECTED_COST || Number(row.dbPost?.cost) !== EXPECTED_COST)) {
      throw new Error("최종 시트/DB 검증 실패");
    }
    return response({
      ok: true,
      backupJobId: backup.id,
      sheetWrite,
      before: before.inspected,
      after: verified.inspected,
    });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
}
