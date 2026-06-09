import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 상품별 검색량 Google Sheet (공개 링크 · CSV 내보내기)
// 컬럼: 날짜, 라라스윗 라라스윗(전체), 쫀득바…, 파인트… 등 상품별 일별 검색량
const SHEET_ID = "1fxxxTHRQUQ7NIAB8WSK2lKjPyVYrPe63_RPMKfm_v3M";
const SHEET_GID = "426959601";
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

// 브랜드 전체 검색량 컬럼 (개별 상품 목록에서는 제외)
const BRAND_KEY = "라라스윗 라라스윗";

/** gviz CSV 파싱 (모든 필드가 따옴표로 감싸짐, 숫자에 천단위 콤마 포함) */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function toNum(cell: string | undefined): number | null {
  if (!cell) return null;
  const n = Number(cell.replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let text: string;
  try {
    const res = await fetch(CSV_URL, { next: { revalidate: 1800 } });
    if (!res.ok) return NextResponse.json({ error: `시트 조회 실패: ${res.status}` }, { status: 502 });
    text = await res.text();
  } catch {
    return NextResponse.json({ error: "시트 네트워크 오류" }, { status: 502 });
  }

  const rows = parseCsv(text);
  if (rows.length < 2) return NextResponse.json({ brandKey: BRAND_KEY, products: [], data: [] });

  const header = rows[0].map(h => h.trim());
  const productCols = header.slice(1); // 0번은 날짜

  const data = rows.slice(1)
    .map(r => {
      const date = (r[0] ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
      const values: Record<string, number | null> = {};
      productCols.forEach((name, j) => { values[name] = toNum(r[j + 1]); });
      return { date, values };
    })
    .filter((d): d is { date: string; values: Record<string, number | null> } => d !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  // 개별 상품 목록 = 브랜드 전체 컬럼 제외
  const products = productCols.filter(name => name !== BRAND_KEY);

  return NextResponse.json({ brandKey: BRAND_KEY, products, data });
}
