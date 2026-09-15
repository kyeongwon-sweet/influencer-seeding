import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { fetchSheetTabValues, getSheetTitles } from "@/lib/google-sheets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const SHEET_ID = "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak";
const SHEET_GID = 1937186871;
const SHEET_RANGE = "A1:CZ5000";
const PRICING_GID = 1649102171;
const PRICING_RANGE = "A1:H500";

async function handler(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [values, pricingValues, sheetTitles] = await Promise.all([
      fetchSheetTabValues(SHEET_ID, SHEET_GID, SHEET_RANGE),
      fetchSheetTabValues(SHEET_ID, PRICING_GID, PRICING_RANGE),
      getSheetTitles(SHEET_ID),
    ]);
    return NextResponse.json(
      {
        ok: true,
        spreadsheet_id: SHEET_ID,
        gid: SHEET_GID,
        range: SHEET_RANGE,
        values,
        pricing_gid: PRICING_GID,
        pricing_range: PRICING_RANGE,
        pricing_values: pricingValues,
        sheet_titles: sheetTitles,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function GET(req: NextRequest) {
  return handler(req);
}

export async function POST(req: NextRequest) {
  return handler(req);
}
