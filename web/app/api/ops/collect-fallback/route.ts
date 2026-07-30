import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { yesterdayKST } from "@/lib/dateRule";
import { notifyBot } from "@/lib/slack";
import { decideFallback, formatFallback } from "@/lib/collect-fallback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 자정수집 폴백 — GitHub 스케줄러가 죽어도 데이터가 비지 않게 한다.
 *
 * 2026-07-30 사고: GitHub Actions 스케줄이 두 repo 모두 전면 정지(09:11 KST 이후). 자정수집이
 * 안 돌면 그날 데이터가 통째로 빈다(7/29은 3회 실패 후 수동 복구로 겨우 메움).
 * 구글(Apps Script) 시간 트리거가 새벽에 이 라우트를 호출한다 = GitHub과 독립 경로.
 *
 * 안전장치:
 *  - **정말 비어 있을 때만** 수집을 시작한다(자동행 < 임계값). 정상이면 무동작 → 중복수집·Apify 비용 0.
 *  - 수집은 `/api/monitoring/apify-collect`(Apify run만 시작, 웹훅이 적재)로 위임 → 서버리스 타임아웃 무관.
 *  - `?dry_run=1`이면 판정만 하고 실제 수집은 하지 않는다(스모크 테스트용).
 *  - DB 조회가 이상하면 수집하지 않고 알림만(함부로 비용 태우지 않음).
 */

const MIN_ROWS = Number(process.env.FALLBACK_MIN_ROWS || "100");

async function handler(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dryRun = req.nextUrl.searchParams.get("dry_run") === "1";
  const kdate = req.nextUrl.searchParams.get("date") || yesterdayKST();

  const supabase = getServerSupabase();
  let autoRows = -1;
  try {
    const { count, error } = await supabase
      .from("post_daily_stats")
      .select("id", { count: "exact", head: true })
      .eq("measured_at", kdate)
      .eq("manual", false);
    if (error) throw new Error(error.message);
    autoRows = count ?? 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyBot(`⚠️ [자정수집 폴백] ${kdate} DB 조회 실패로 폴백 보류 — ${msg.slice(0, 200)}`).catch(() => {});
    return NextResponse.json({ error: msg, kdate }, { status: 500 });
  }

  const decision = decideFallback(autoRows, MIN_ROWS);
  let started: boolean | undefined;

  if (decision.act && !dryRun) {
    try {
      const base = process.env.APP_URL || `https://${req.headers.get("host")}`;
      const res = await fetch(`${base}/api/monitoring/apify-collect`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
        cache: "no-store",
      });
      started = res.ok;
      if (!res.ok) console.error("[collect-fallback] apify-collect", res.status, await res.text());
    } catch (e) {
      started = false;
      console.error("[collect-fallback] apify-collect 예외", e);
    }
  }

  const text = formatFallback(decision, kdate, dryRun, started);
  // 정상(이미 수집됨)일 때는 조용히 — 폴백이 필요했거나 실패했을 때만 알린다.
  if (decision.reason !== "already_collected") await notifyBot(text).catch(() => {});

  return NextResponse.json({ ok: true, kdate, dryRun, ...decision, started, message: text });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
