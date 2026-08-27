import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { fetchSheetTabFormulas, fetchSheetTabValues } from "@/lib/google-sheets";
import { normalizeSheetHeader, toSheetNumber } from "@/lib/sheet-banner-reach";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeUrl, postIdentityKey } from "@/lib/url-utils";
import { todayKST } from "@/lib/dateRule";
import { FORMULA_AUDIT_SERVICE, shouldSkipFormulaAuditReport } from "@/lib/formula-audit-dedupe";
import { notifyBot } from "@/lib/slack";
import {
  auditRows,
  dominantMetricFormulaEndColumn,
  formatAuditMessage,
  resolveMetricDateColumns,
  type AuditPost,
  type SheetAuditRow,
} from "@/lib/formula-audit";

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
  if (!error) return (data?.length ?? 0) > 0;

  console.error("[formula-audit] ops_daily_runs lookup failed; falling back to jobs", error.message);
  const fallback = await supabase
    .from("jobs")
    .select("id, payload")
    .eq("type", "monitoring")
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(100);
  if (fallback.error) {
    console.error("[formula-audit] fallback dedupe lookup failed", fallback.error.message);
    return null;
  }
  return (fallback.data ?? []).some((row) => {
    const payload = row.payload as { ops_marker?: unknown; run_date?: unknown } | null;
    return payload?.ops_marker === FORMULA_AUDIT_SERVICE && payload?.run_date === kdate;
  });
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
  if (!error) return;

  console.error("[formula-audit] ops_daily_runs mark failed; falling back to jobs", error.message);
  const fallback = await supabase
    .from("jobs")
    .insert({
      type: "monitoring",
      status: "done",
      payload: {
        ops_marker: FORMULA_AUDIT_SERVICE,
        run_date: kdate,
        ...payload,
      },
    });
  if (fallback.error) console.error("[formula-audit] fallback dedupe mark failed", fallback.error.message);
}

function linkKeyOf(url: string): string {
  const normalized = normalizeUrl(url) ?? url;
  return postIdentityKey(normalized) ?? normalized;
}

function columnNumberToA1(columnNumber: number): string {
  let n = columnNumber;
  let out = "";
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

function a1ColumnToNumber(column: string): number {
  return column.toUpperCase().split("").reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

async function handler(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const kdate = todayKST();
  const force = req.nextUrl.searchParams.get("force") === "1";
  const supabase = getServerSupabase();

  type SheetSnapshot = {
    values: (string | number | boolean | null)[][];
    header: (string | number | boolean | null)[];
    urlCol: number;
    cumCol: number;
    incCol: number;
    acctCol: number;
    statusCol: number;
    formulaFirstCol: number;
    formulaValues: (string | number | boolean | null)[][];
  };
  const loadSnapshot = async (): Promise<SheetSnapshot> => {
    const values = await fetchSheetTabValues(SHEET_ID, SHEET_GID, SHEET_RANGE);
    // 대량 범위와 별도로 1행을 다시 읽는다. Apps Script 대량 쓰기 직후 큰 범위가 직전
    // 헤더 스냅샷을 돌려주고 H/I 수식 조회만 최신인 혼합 응답(2026-08-27)을 막는다.
    const latestHeader = (await fetchSheetTabValues(SHEET_ID, SHEET_GID, "A1:ZZ1"))[0];
    const header = latestHeader?.length ? latestHeader : (values[0] ?? []);
    values[0] = header;
    const findCol = (names: string[]) =>
      header.findIndex((h) => names.includes(normalizeSheetHeader(h as string | number | null)));
    const urlCol = findCol(["게시물url"]);
    const cumCol = findCol(["누적조회수", "누적 조회수"]);
    const incCol = findCol(["증분값", "증분"]);
    const acctCol = findCol(["채널명"]);
    const statusCol = findCol(["등록상태"]);
    const formulaFirstCol = Math.min(cumCol, incCol);
    const formulaLastCol = Math.max(cumCol, incCol);
    const formulaRange = `${columnNumberToA1(formulaFirstCol + 1)}2:${columnNumberToA1(formulaLastCol + 1)}${Math.max(2, values.length)}`;
    const formulaValues = urlCol >= 0 && cumCol >= 0 && incCol >= 0
      ? await fetchSheetTabFormulas(SHEET_ID, SHEET_GID, formulaRange)
      : [];
    return { values, header, urlCol, cumCol, incCol, acctCol, statusCol, formulaFirstCol, formulaValues };
  };

  let snapshot: SheetSnapshot;
  try {
    snapshot = await loadSnapshot();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await notifyBot(`🔴 [수식 전수감사] 시트 읽기 실패 — ${msg.slice(0, 200)}`).catch(() => {});
    return NextResponse.json({ error: msg }, { status: 502 });
  }
  if (snapshot.urlCol < 0 || snapshot.cumCol < 0 || snapshot.incCol < 0) {
    await notifyBot(`🔴 [수식 전수감사] 헤더 인식 실패 — url:${snapshot.urlCol} 누적:${snapshot.cumCol} 증분:${snapshot.incCol}`).catch(() => {});
    return NextResponse.json({ error: "header not found" }, { status: 500 });
  }

  const detectDateCols = (current: SheetSnapshot) => resolveMetricDateColumns(
    current.header,
    current.incCol + 1,
    current.statusCol > current.incCol ? current.statusCol : current.header.length,
    STATS_START_YEAR,
  );
  const formulaEnd = (current: SheetSnapshot) => dominantMetricFormulaEndColumn(
    current.formulaValues.flatMap((row) => [
      row[current.cumCol - current.formulaFirstCol],
      row[current.incCol - current.formulaFirstCol],
    ]),
  );
  const snapshotAhead = (
    currentDateCols: ReturnType<typeof detectDateCols>,
    dominant: ReturnType<typeof formulaEnd>,
  ) => dominant != null && currentDateCols.length > 0
    && dominant.count >= 20
    && dominant.count > dominant.total / 2
    && a1ColumnToNumber(dominant.column) > currentDateCols[currentDateCols.length - 1].idx + 1;

  let dateCols = detectDateCols(snapshot);
  let dominantFormulaEnd = formulaEnd(snapshot);
  let snapshotRetryCount = 0;
  if (snapshotAhead(dateCols, dominantFormulaEnd)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      snapshot = await loadSnapshot();
      dateCols = detectDateCols(snapshot);
      dominantFormulaEnd = formulaEnd(snapshot);
      snapshotRetryCount = 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg, retryable: true }, { status: 502 });
    }
  }
  if (snapshotAhead(dateCols, dominantFormulaEnd)) {
    const lastColumn = dateCols.length ? columnNumberToA1(dateCols[dateCols.length - 1].idx + 1) : null;
    const message = `⚠️ [수식 전수감사] 시트 스냅샷 불일치 — 날짜 헤더 ${lastColumn ?? "없음"}, H/I 수식 ${dominantFormulaEnd?.column ?? "없음"}. 대량 오탐을 막고 다음 실행에서 재시도합니다.`;
    await notifyBot(message).catch(() => {});
    return NextResponse.json({
      error: "sheet_snapshot_not_ready",
      retryable: true,
      snapshotRetryCount,
      headerLastColumn: lastColumn,
      dominantFormulaEnd,
    }, { status: 503 });
  }

  const { values, header, urlCol, cumCol, incCol, acctCol, formulaFirstCol, formulaValues } = snapshot;
  if (dateCols.length === 0) {
    // 실패 시 자기진단: 헤더 표본을 함께 알려 원인(형식 변경 등)을 즉시 알 수 있게 한다.
    const sample = header.slice(incCol + 1, incCol + 9).map((h) => String(h ?? "")).join(" | ");
    await notifyBot(`🔴 [수식 전수감사] 날짜 열을 찾지 못했습니다 — 헤더 표본: ${sample}`).catch(() => {});
    return NextResponse.json({ error: "no date columns", headerSample: sample }, { status: 500 });
  }
  const metricRange = {
    firstColumn: columnNumberToA1(dateCols[0].idx + 1),
    lastColumn: columnNumberToA1(dateCols[dateCols.length - 1].idx + 1),
    columns: dateCols.map((dc) => columnNumberToA1(dc.idx + 1)),
  };
  const metricRangeSummary = {
    firstColumn: metricRange.firstColumn,
    lastColumn: metricRange.lastColumn,
  };
  const inferredDateColumns = dateCols
    .filter((dc) => dc.inferred)
    .map((dc) => ({ column: columnNumberToA1(dc.idx + 1), date: dc.date }));

  // 시트 행 파싱 (raw 셀은 UNFORMATTED라 오류셀은 "#REF!" 같은 문자열로 온다)
  const rows: SheetAuditRow[] = [];
  const orphanNotes: string[] = [];
  for (let i = 1; i < values.length; i += 1) {
    const row = values[i] ?? [];
    const url = String(row[urlCol] ?? "").trim();
    const dates: Array<{ date: string; value: number; column: string }> = [];
    for (const dc of dateCols) {
      const n = toSheetNumber(row[dc.idx] as string | number | null);
      if (n != null && n > 0) dates.push({
        date: dc.date,
        value: n,
        column: columnNumberToA1(dc.idx + 1),
      });
    }
    const rawCell = (v: unknown): number | string | null => {
      if (v == null || v === "") return null;
      if (typeof v === "number") return v;
      const n = toSheetNumber(v as string);
      return n != null ? n : String(v);
    };
    const h = rawCell(row[cumCol]);
    const inc = rawCell(row[incCol]);
    if (!url) {
      if (dates.length > 0 || h != null || inc != null) {
        const latest = dates.length ? dates[dates.length - 1] : null;
        orphanNotes.push(`고아행 ${i + 1}: URL 없음 · H=${h ?? "빈칸"} · 최근=${latest ? `${latest.date} ${latest.value}` : "날짜값 없음"}`);
      }
      continue;
    }
    rows.push({
      key: linkKeyOf(url),
      label: String(row[acctCol >= 0 ? acctCol : urlCol] ?? "").trim().slice(0, 20) || url.slice(-16),
      sourceRow: i + 1,
      h,
      inc,
      hFormula: formulaValues[i - 1]?.[cumCol - formulaFirstCol] ?? null,
      incFormula: formulaValues[i - 1]?.[incCol - formulaFirstCol] ?? null,
      metricRange,
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

  const result = auditRows(rows, posts, kdate, orphanNotes);
  const { text, healthy } = formatAuditMessage(result);
  const alreadyReported = await hasTodayReport(supabase, kdate);
  if (alreadyReported != null && shouldSkipFormulaAuditReport({ alreadyReported, force })) {
    return NextResponse.json({
      ok: true,
      healthy,
      slackSent: false,
      skippedNotify: true,
      reason: "already_reported",
      kdate,
      dedupeLookupOk: true,
      dateColumnCount: dateCols.length,
      metricRange: metricRangeSummary,
      inferredDateColumns,
      snapshotRetryCount,
      dominantFormulaEnd,
      ...result,
    });
  }

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
      hFormulaInvalid: result.formulaShape.hInvalid,
      hFormulaManual: result.formulaShape.hManual,
      incFormulaInvalid: result.formulaShape.incInvalid,
      stale: result.stale,
      orphanRows: result.orphanRows,
    });
  }

  return NextResponse.json({
    ok: true,
    healthy,
    slackSent,
    skippedNotify: false,
    dedupeLookupOk: alreadyReported != null,
    dateColumnCount: dateCols.length,
    metricRange: metricRangeSummary,
    inferredDateColumns,
    snapshotRetryCount,
    dominantFormulaEnd,
    ...result,
  });
}

export async function POST(req: NextRequest) { return handler(req); }
export async function GET(req: NextRequest) { return handler(req); }
