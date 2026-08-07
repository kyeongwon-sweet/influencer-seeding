import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { fetchSheetTabValues } from "@/lib/google-sheets";
import { normalizeSheetHeader, toSheetNumber } from "@/lib/sheet-banner-reach";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, postIdentityKey } from "@/lib/url-utils";
import { todayKST } from "@/lib/dateRule";
import { FORMULA_AUDIT_SERVICE, shouldSkipFormulaAuditReport } from "@/lib/formula-audit-dedupe";
import { notifyBot } from "@/lib/slack";
import { auditRows, formatAuditMessage, parseHeaderDate, type AuditPost, type SheetAuditRow } from "@/lib/formula-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * 연동시트 누적(H)·증분(I) 수식 전수감사 → Slack 보고 (매일 아침 GHA 크론)
 *
 * 읽기 전용: 시트는 SA read-only, DB는 조회만. 수정/보정 없음 — 감지 알림만(무결성 절대규칙).
 * dailyAuto(08:30)의 수식 재기입 직후(09:10 KST)에 돌아, 파손이 하루 이상 방치되지 않게 한다.
 * 판정 규칙과 오탐 방지(이중 기대값)는 lib/formula-audit.ts 참조.
 */

const SHEET_ID = "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak";
const SHEET_GID = 1937186871;
const SHEET_RANGE = "A1:ZZ5000";
const STATS_START_YEAR = 2026;

async function hasTodayReport(supabase: ReturnType<typeof getServerSupabase>, kdate: string): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("ops_daily_runs")
    .select("id")
    .eq("service", FORMULA_AUDIT_SERVICE)
    .eq("run_date", kdate)
    .eq("status", "done")
    .limit(1);
  if (error) {
    console.error("[formula-audit] dedupe lookup failed", error.message);
    return null;
  }
  return (data?.length ?? 0) > 0;
}

async function markTodayReport(
  supabase: ReturnType<typeof getServerSupabase>,
  kdate: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from("ops_daily_runs")
    .upsert({
      service: FORMULA_AUDIT_SERVICE,
      run_date: kdate,
      status: "done",
      payload,
    }, { onConflict: "service,run_date" });
  if (error) console.error("[formula-audit] dedupe mark failed", error.message);
}

function linkKeyOf(url: string): string {
  const normalized = normalizeUrl(url) ?? url;
  return postIdentityKey(normalized) ?? normalized;
}

async function handler(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const kdate = todayKST();
  const force = req.nextUrl.searchParams.get("force") === "1";
  const supabase = getServerSupabase();
  const alreadyReported = await hasTodayReport(supabase, kdate);
  if (alreadyReported != null && shouldSkipFormulaAuditReport({ alreadyReported, force })) {
    return NextResponse.json({ ok: true, skipped: true, reason: "already_reported", kdate });
  }

  let values: (string | number | boolean | null)[][];
  try {
    values = await fetchSheetTabValues(SHEET_ID, SHEET_GID, SHEET_RANGE);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyBot(`🔴 [수식 전수감사] 시트 읽기 실패 — ${msg.slice(0, 200)}`).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const header = values[0] ?? [];
  const findCol = (names: string[]) =>
    header.findIndex((h) => names.includes(normalizeSheetHeader(h as string | number | null)));
  const urlCol = findCol(["게시물url"]);
  const cumCol = findCol(["누적조회수", "누적 조회수"]);
  const incCol = findCol(["증분값", "증분"]);
  const acctCol = findCol(["채널명"]);
  if (urlCol < 0 || cumCol < 0 || incCol < 0) {
    await notifyBot(`🔴 [수식 전수감사] 헤더 인식 실패 — url:${urlCol} 누적:${cumCol} 증분:${incCol}`).catch(() => {});
    return NextResponse.json({ error: "header not found" }, { status: 500 });
  }

  // 날짜 열: 월.일 / 2자리연도 접두(26.7.16) / 4자리연도 / 날짜셀 혼재를 모두 인식(parseHeaderDate).
  const dateCols: Array<{ idx: number; date: string }> = [];
  const state = { year: STATS_START_YEAR, prevMonth: null as number | null };
  for (let c = incCol + 1; c < header.length; c += 1) {
    const ymd = parseHeaderDate(header[c] as string | number | null, state);
    if (ymd) dateCols.push({ idx: c, date: ymd });
  }
  if (dateCols.length === 0) {
    // 실패 시 자기진단: 헤더 표본을 함께 알려 원인(형식 변경 등)을 즉시 알 수 있게 한다.
    const sample = header.slice(incCol + 1, incCol + 9).map((h) => String(h ?? "")).join(" | ");
    await notifyBot(`🔴 [수식 전수감사] 날짜 열을 찾지 못했습니다 — 헤더 표본: ${sample}`).catch(() => {});
    return NextResponse.json({ error: "no date columns", headerSample: sample }, { status: 500 });
  }

  // 시트 행 파싱 (raw 셀은 UNFORMATTED라 오류셀은 "#REF!" 같은 문자열로 온다)
  const rows: SheetAuditRow[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i] ?? [];
    const url = String(row[urlCol] ?? "").trim();
    if (!url) continue;
    const dates: Array<{ date: string; value: number }> = [];
    for (const dc of dateCols) {
      const n = toSheetNumber(row[dc.idx] as string | number | null);
      if (n != null && n > 0) dates.push({ date: dc.date, value: n });
    }
    const rawCell = (v: unknown): number | string | null => {
      if (v == null || v === "") return null;
      if (typeof v === "number") return v;
      const n = toSheetNumber(v as string);
      return n != null ? n : String(v);
    };
    rows.push({
      key: linkKeyOf(url),
      label: String(row[acctCol >= 0 ? acctCol : urlCol] ?? "").trim().slice(0, 20) || url.slice(-16),
      h: rawCell(row[cumCol]),
      inc: rawCell(row[incCol]),
      dates,
    });
  }

  // DB: 게시물 + 일별 실측(배너=reach 우선) — id 2차 정렬 페이지네이션
  const auditDates = rows.flatMap((row) => row.dates.map((d) => d.date));
  const minAuditDate = auditDates.length > 0 ? auditDates.reduce((a, b) => a < b ? a : b) : null;
  const maxAuditDate = auditDates.length > 0 ? auditDates.reduce((a, b) => a > b ? a : b) : null;
  const posts = new Map<string, AuditPost>();
  const idToKey = new Map<string, string>();
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("sponsored_posts")
        .select("id, url, posted_at, ended_at, channel_type")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const p of data ?? []) {
        const key = linkKeyOf(String(p.url));
        idToKey.set(String(p.id), key);
        posts.set(key, {
          posted: p.posted_at ? String(p.posted_at).slice(0, 10) : null,
          ended: p.ended_at ? String(p.ended_at).slice(0, 10) : null,
          channelType: p.channel_type ? String(p.channel_type) : null,
          measured: new Map(),
        });
      }
      if (!data || data.length < PAGE) break;
    }
    for (let from = 0; ; from += PAGE) {
      let query = supabase
        .from("post_daily_stats")
        .select("post_id, measured_at, play_count, reach_count, id");
      if (minAuditDate) query = query.gte("measured_at", minAuditDate);
      if (maxAuditDate) query = query.lte("measured_at", maxAuditDate);
      const { data, error } = await query
        .order("post_id", { ascending: true })
        .order("measured_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const s of data ?? []) {
        const key = idToKey.get(String(s.post_id));
        if (!key) continue;
        const metric = Number(s.reach_count ?? s.play_count ?? 0);
        if (metric > 0) posts.get(key)?.measured.set(String(s.measured_at).slice(0, 10), metric);
      }
      if (!data || data.length < PAGE) break;
    }
  }

  const result = auditRows(rows, posts, todayKST());
  const { text, healthy } = formatAuditMessage(result);
  let slackSent = true;
  await notifyBot(text).catch((e) => {
    slackSent = false;
    console.error("[formula-audit] Slack notify failed", e);
  });
  if (slackSent) {
    await markTodayReport(supabase, kdate, {
      healthy,
      rows: result.totalRows,
      hError: result.h.errorCells,
      hEmptyButData: result.h.emptyButData,
      incError: result.inc.errorCells,
      incMismatch: result.inc.mismatch,
      incBlankExpected: result.inc.blankExpected,
      stale: result.stale,
    });
  }

  return NextResponse.json({ ok: true, healthy, slackSent, dedupeLookupOk: alreadyReported != null, ...result });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
