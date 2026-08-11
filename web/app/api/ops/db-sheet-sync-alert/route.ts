import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { formatDbSheetSyncAlert, type DbSheetSyncAlertInput } from "@/lib/db-sheet-sync-alert";
import { notifyBot } from "@/lib/slack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let input: DbSheetSyncAlertInput = {};
  try {
    input = (await req.json()) as DbSheetSyncAlertInput;
  } catch {
    input = { error: "알림 payload JSON 파싱 실패" };
  }
  const message = formatDbSheetSyncAlert(input);
  await notifyBot(message);
  return NextResponse.json({ ok: true, message });
}
