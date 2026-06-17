import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { notifyJob } from "@/lib/slack";

const SPREADSHEET_ID = "1QpUgPdiZGXtgXnRnDld99Kp1qP0rRbqwyv0aYbJ_Omo";
const SHEET_GID = 1808124579;

function parseNum(v: string): number | null {
  if (!v || v.trim() === "") return null;
  const s = v.replace(/[,\s%]/g, "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseAchieve(v: string): number | null {
  const n = parseNum(v);
  if (n == null) return null;
  // Sheets CSV returns decimal for %-formatted cells (0.25 → 25)
  if (n > 0 && n <= 1) return Math.round(n * 100);
  return Math.round(n);
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split("\n")) {
    const cells: string[] = [];
    let inQuote = false;
    let cell = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && !inQuote) { inQuote = true; continue; }
      if (ch === '"' && inQuote) {
        if (line[i + 1] === '"') { cell += '"'; i++; } else { inQuote = false; }
        continue;
      }
      if (ch === "," && !inQuote) { cells.push(cell); cell = ""; continue; }
      cell += ch;
    }
    cells.push(cell.replace(/\r$/, ""));
    rows.push(cells);
  }
  return rows;
}

export async function GET(req: NextRequest) {
  // Vercel Cron sets Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // CSV export — no API key needed if the sheet is "Anyone with link can view"
  const csvUrl = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${SHEET_GID}`;
  const res = await fetch(csvUrl, { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Google Sheets CSV 다운로드 실패 (${res.status}). 스프레드시트가 "링크 있는 사람 누구나 보기"로 설정됐는지 확인하세요.` },
      { status: 502 }
    );
  }

  const text = await res.text();
  const allRows = parseCSV(text);

  // B4:I7 → 0-indexed rows[3..6], cols[1..8]
  const rows = allRows.slice(3, 7).map(r => r.slice(1, 9));

  if (rows.length < 3) {
    return NextResponse.json({ error: "시트 데이터가 부족합니다 (B4:I7 범위 확인)" }, { status: 500 });
  }

  const headerRow  = rows[0];
  const targetRow  = rows[1];
  const currentRow = rows[2];
  const achieveRow = rows[3] ?? [];

  const monthLabel = headerRow[0]?.trim() ?? "";
  const metrics: { label: string; target: number | null; current: number | null; achievement: number | null }[] = [];
  for (let i = 1; i < headerRow.length; i++) {
    const label = headerRow[i]?.trim() ?? "";
    if (!label) continue;
    metrics.push({
      label,
      target:      parseNum(targetRow[i] ?? ""),
      current:     parseNum(currentRow[i] ?? ""),
      achievement: parseAchieve(achieveRow[i] ?? ""),
    });
  }

  const supabase = getServerSupabase();
  const { error } = await supabase.from("kpi_snapshots").insert({ month_label: monthLabel, metrics });
  if (error) {
    await notifyJob("KPI 스냅샷", "fail", `DB 저장 실패: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await notifyJob("KPI 스냅샷", "ok", `${monthLabel} ${metrics.length}개 지표`);
  return NextResponse.json({ ok: true, month_label: monthLabel, metrics });
}
