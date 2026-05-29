import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

const SPREADSHEET_ID = "1QpUgPdiZGXtgXnRnDld99Kp1qP0rRbqwyv0aYbJ_Omo";
const SHEET_GID = 1808124579;
const RANGE = "B4:I7";

function parseNum(v: string | number | null | undefined): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const s = String(v).replace(/[,\s]/g, "").replace("%", "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseAchieve(v: string | number | null | undefined): number | null {
  const n = parseNum(v);
  if (n == null) return null;
  // Sheets returns decimal for %-formatted cells (0.25 → 25)
  if (n > 0 && n <= 1) return Math.round(n * 100);
  return Math.round(n);
}

export async function GET(req: NextRequest) {
  // Vercel Cron sets Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_SHEETS_API_KEY not set" }, { status: 500 });
  }

  // Step 1: resolve sheet name from gid
  let sheetName = "";
  try {
    const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}?key=${apiKey}&fields=sheets.properties`;
    const metaRes = await fetch(metaUrl);
    const meta = await metaRes.json() as { sheets?: { properties?: { sheetId?: number; title?: string } }[] };
    const sheet = meta.sheets?.find(s => s.properties?.sheetId === SHEET_GID);
    sheetName = sheet?.properties?.title ?? "";
  } catch {
    // Fall through with no sheet name (defaults to first sheet)
  }

  // Step 2: fetch range
  const rangeStr = sheetName ? `'${sheetName}'!${RANGE}` : RANGE;
  const valUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(rangeStr)}?key=${apiKey}&valueRenderOption=UNFORMATTED_VALUE`;

  const valRes = await fetch(valUrl);
  if (!valRes.ok) {
    const text = await valRes.text();
    return NextResponse.json({ error: `Sheets API: ${text}` }, { status: 502 });
  }

  const json = await valRes.json() as { values?: (string | number)[][] };
  const values = json.values ?? [];

  if (values.length < 3) {
    return NextResponse.json({ error: "Not enough rows in range" }, { status: 500 });
  }

  // Row 0 = B4 (headers): [month_label, metric1, metric2, ...]
  // Row 1 = B5 (목표):   [label, target1, target2, ...]
  // Row 2 = B6 (현황):   [label, current1, current2, ...]
  // Row 3 = B7 (달성률): [label, achieve1, achieve2, ...]
  const headerRow  = values[0];
  const targetRow  = values[1];
  const currentRow = values[2];
  const achieveRow = values[3] ?? [];

  const monthLabel = String(headerRow[0] ?? "");

  const metrics = [];
  for (let i = 1; i < headerRow.length; i++) {
    const label = String(headerRow[i] ?? "").trim();
    if (!label) continue;
    metrics.push({
      label,
      target:      parseNum(targetRow[i]),
      current:     parseNum(currentRow[i]),
      achievement: parseAchieve(achieveRow[i]),
    });
  }

  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("kpi_snapshots")
    .insert({ month_label: monthLabel, metrics });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, month_label: monthLabel, metrics });
}
