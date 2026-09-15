import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { validateConfig, validateResult, analyzeTrends, trendSummary, validDate } from "@/lib/google-search-tracker";
export async function POST(request: Request) {
  if (!(await auth()).userId) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  try {
    const raw = await request.text(); if (raw.length > 1000000) throw new Error("내보낼 데이터가 너무 큽니다.");
    const body = JSON.parse(raw), c = validateConfig(body.config), r = validateResult(body.result, c);
    const book = new ExcelJS.Workbook();
    const info = book.addWorksheet("분석 기준");
    info.addRows([["지표", "Google Trends 상대 관심도 0–100 (실제 검색 횟수가 아님)"], ["국가", c.geo || "전 세계"], ["분석 시작", c.start], ["분석 종료", c.end], ["수집 시각", r.collectedAt], ["간격", r.granularity], ["출처", r.sourceUrl], ["급등 기준", `직전 28일 유효 표본 평균 × ${c.multiplier}, 최소 지수 ${c.minIndex}, 최소 과거 표본 3개`], ["이벤트 묶음", `${c.gapDays}일 이내 급등, 3개 이상·7일 이상이면 지속 상승`], ["정규화", "모든 상품을 한 비교 요청으로 수집. 분석 전 28일도 정규화 범위에 포함."], ["결측", "hasData=false 및 미완료 값은 공란. 0은 실제 검색 0회를 의미하지 않음."], ...r.warnings.map(w => ["주의", w])]);
    const series = book.addWorksheet("검색 관심도");
    series.addRow(["날짜 (UTC)", "분석/기준 구간", ...c.groups.map(g => g.label)]);
    r.points.forEach(p => series.addRow([p.date, p.date < c.start ? "직전 기준" : "분석", ...p.values]));
    const summary = book.addWorksheet("상품 요약");
    summary.addRow(["상품", "검색어 (OR)", "최고 관심도", "최고 날짜", "유효 표본 평균 관심도", "유효 표본 수"]);
    c.groups.forEach((g, i) => { const s = trendSummary(r, c, i); summary.addRow([g.label, g.terms.join(" + "), s.peak, s.date, s.mean, s.count]); });
    const events = book.addWorksheet("이벤트");
    events.addRow(["상품", "유형", "시작", "종료", "피크 날짜", "피크 지수", "직전 28일 평균", "상승률 (%)"]);
    analyzeTrends(r, c).forEach(e => events.addRow([c.groups[e.group].label, e.kind, e.start, e.end, e.date, e.peak, e.baseline, e.change]));
    if (Array.isArray(body.manual)) body.manual.slice(0, 100).forEach((e: { group: number; date: string }) => { if (Number.isInteger(e.group) && c.groups[e.group] && validDate(e.date) && e.date >= c.start && e.date <= c.end) events.addRow([c.groups[e.group].label, "수동 날짜", e.date, e.date, e.date, r.points.find(p => p.date === e.date)?.values[e.group] ?? null, null, null]); });
    const content = book.addWorksheet("조회 콘텐츠");
    content.addRow(["이벤트", "제목", "URL", "작성자", "게시일", "조회수", "좋아요", "설명"]);
    if (body.contents && typeof body.contents === "object") Object.entries(body.contents).slice(0, 300).forEach(([key, rows]) => { if (Array.isArray(rows)) rows.slice(0, 20).forEach(p => content.addRow([key.slice(0, 150), String(p.title || "").slice(0, 500), String(p.url || "").slice(0, 1000), String(p.author || "").slice(0, 200), p.date || null, typeof p.views === "number" ? p.views : null, typeof p.likes === "number" ? p.likes : null, String(p.description || "").slice(0, 1500)])); });
    book.eachSheet(sheet => { sheet.views = [{ state: "frozen", ySplit: 1 }]; sheet.getRow(1).font = { bold: true }; sheet.columns.forEach((column, i) => { column.width = i === 0 ? 24 : 30; }); });
    const buffer = await book.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="google-search-tracker-${c.start}-${c.end}.xlsx"` } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "내보내기 실패" }, { status: 400 }); }
}
