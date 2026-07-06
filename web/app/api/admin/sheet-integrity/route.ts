import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchSheetTabValues } from "@/lib/google-sheets";
import { normalizeUrl } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 연동시트([빙과] 마케팅_대시보드 실무용 → [콘텐츠 대시보드 연동] 탭)의 '게시일 이전 일자별 조회수 칸'을
// 서버측(서비스계정)에서 직접 점검하는 진단 라우트 — 시트 상태를 사람 눈/스크린샷에 의존하지 않기 위함.
// ⚠️ 서비스계정(GOOGLE_SA_CLIENT_EMAIL)이 이 스프레드시트에 뷰어 이상으로 공유돼 있어야 동작(403이면 미공유).
// 게시일 기준은 시트 날짜셀 파싱 대신 DB posted_at(URL 정규화 조인) — 삭제 기준과 동일 소스.
const SHEET_ID = "10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak";
const GID = 1937186871;
const STATS_FIRST_COL = 9;   // I열부터 일자별 조회수 (Combined_Sheet_AppsScript CONFIG와 동일)
const STATS_START_YEAR = 2026;

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let values: (string | number | null)[][];
  try {
    values = await fetchSheetTabValues(SHEET_ID, GID, "A1:CZ3000");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const shared = !/403/.test(msg);
    return NextResponse.json({ error: msg, hint: shared ? "시트 조회 실패" : "서비스계정 미공유(403) — 시트를 GOOGLE_SA_CLIENT_EMAIL에 뷰어로 공유 필요" }, { status: 502 });
  }
  if (values.length < 2) return NextResponse.json({ error: "시트 데이터 없음" }, { status: 502 });

  // 헤더 파싱: 게시물URL 열 + 날짜 열(I열~, "M/D" 헤더, 월이 줄면 해 넘김)
  const header = values[0];
  const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, "").toLowerCase();
  const urlCol = header.findIndex(h => norm(h) === "게시물url");
  if (urlCol === -1) return NextResponse.json({ error: "'게시물URL' 헤더 없음" }, { status: 502 });
  const dateCols: { col: number; date: string }[] = [];
  let year = STATS_START_YEAR, prevMonth: number | null = null;
  for (let c = STATS_FIRST_COL - 1; c < header.length; c++) {
    const m = String(header[c] ?? "").match(/(\d{1,2})\D+(\d{1,2})/);
    if (!m) continue;
    const mo = +m[1], da = +m[2];
    if (prevMonth !== null && mo < prevMonth) year++;
    prevMonth = mo;
    dateCols.push({ col: c, date: `${year}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}` });
  }

  // DB posted_at 조인 (URL 정규화 키)
  const supabase = getServerSupabase();
  const postedByUrl = new Map<string, string>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase.from("sponsored_posts")
      .select("url, posted_at").range(off, off + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) if (r.posted_at) postedByUrl.set(r.url, String(r.posted_at).slice(0, 10));
    if (!data || data.length < 1000) break;
  }

  let matched = 0, unmatched = 0, prePostedCells = 0;
  const affected: { row: number; urlTail: string; posted: string; dates: string[] }[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const rawUrl = String(row?.[urlCol] ?? "").trim();
    if (!rawUrl) continue;
    const posted = postedByUrl.get(normalizeUrl(rawUrl) || rawUrl);
    if (!posted) { unmatched++; continue; }
    matched++;
    const dates: string[] = [];
    for (const dc of dateCols) {
      if (dc.date >= posted) continue;
      const v = row?.[dc.col];
      if (v !== "" && v != null) { prePostedCells++; dates.push(dc.date.slice(5)); }
    }
    if (dates.length > 0 && affected.length < 20) affected.push({ row: i + 1, urlTail: rawUrl.slice(-24), posted, dates });
  }

  return NextResponse.json({
    ok: true,
    sheetRows: values.length - 1,
    matched, unmatched,
    dateCols: dateCols.length,
    prePostedCells,
    affectedRows: affected.length >= 20 ? `${affected.length}+ (표본 20)` : affected.length,
    samples: affected,
  }, { headers: { "Cache-Control": "no-store" } });
}
