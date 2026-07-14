"use client";
import { memo, useEffect, useRef, useState } from "react";
// 게시물 표 — monitoring/page.tsx 에서 추출. 모든 상태/핸들러는 부모(MonitoringPage) 소유(props).
// 인라인 편집/정렬/선택/열 리사이즈는 전부 부모 함수를 props로 받아 그대로 호출 → 동작 동일.
import { type Post, type EditCell, type DailyStats, type Filters, getFilteredStats, pickRangeStats, hasNotableChange, viewIncrement, fmt, fmtChannelType, effectiveReach, bannerDailyMetric, pickMetric, CHANNEL_TYPES, INIT_FILTERS, CHART } from "../lib";
import { MIN_ENTRY_DATE, maxDateKST } from "@/lib/dateRule";
import { companyForAccount } from "@/lib/companyMap";
import { productCodeOf } from "@/lib/productCode";

function TH({ children, right, col, onSort, sorted, className: cls, w, leftPos, onResize, fixed }: {
  children?: React.ReactNode; right?: boolean; col?: string;
  onSort?: () => void; sorted?: "asc" | "desc" | null; className?: string;
  w?: number; leftPos?: number; onResize?: (e: React.MouseEvent) => void; fixed?: boolean;
}) {
  const isSticky = col !== undefined;
  const isLast = col === "증분량";
  const sortable = onSort !== undefined;
  return (
    <th
      onClick={onSort}
      role={sortable ? "button" : undefined}
      tabIndex={sortable ? 0 : undefined}
      onKeyDown={sortable ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSort?.();
        }
      } : undefined}
      aria-sort={
        !sortable ? "none" :
        sorted === "asc" ? "ascending" :
        sorted === "desc" ? "descending" :
        "none"
      }
      style={isSticky ? { width: w, minWidth: w, left: leftPos } : fixed && w ? { width: w, minWidth: w, maxWidth: w } : w ? { minWidth: w } : undefined}
      className={[
        "relative px-3 py-3 text-xs font-medium whitespace-nowrap select-none",
        right ? "text-right" : "text-left",
        sortable ? `cursor-pointer transition-colors ${sorted ? "text-a-ink" : "text-a-ink-muted hover:text-a-ink"}` : "text-a-ink-muted",
        isSticky ? "sticky z-40 bg-white" : "bg-white",
        // 헤더 하단선: sticky th에서 border-b는 안 칠해질 수 있어 inset box-shadow로 그림 (isLast는 좌측 그림자와 합성)
        isLast ? "shadow-[2px_0_5px_rgba(0,0,0,0.06),inset_0_-1.5px_0_#d1d5db]" : "shadow-[inset_0_-1.5px_0_#d1d5db]",
        cls ?? "",
      ].join(" ")}
    >
      {children}
      {sortable && <span className={`ml-1 ${sorted ? "text-a-blue" : "opacity-20"}`}>{sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}</span>}
      {onResize && (
        <div
          className="group/rz absolute right-0 top-0 h-full w-2.5 cursor-col-resize flex justify-end z-20"
          onMouseDown={e => { e.stopPropagation(); onResize(e); }}
          title="드래그하여 열 너비 조절"
        >
          <div className="w-0.5 h-full bg-gray-200 group-hover/rz:bg-a-blue transition-colors" />
        </div>
      )}
    </th>
  );
}

function TD({ children, right, muted, col, highlighted, w, leftPos, fixed, groupStart }: {
  children: React.ReactNode; right?: boolean; muted?: boolean; col?: string; highlighted?: boolean;
  w?: number; leftPos?: number; fixed?: boolean; groupStart?: boolean;
}) {
  const isSticky = col !== undefined;
  const isLast = col === "증분량";
  return (
    <td
      style={isSticky ? { width: w, minWidth: w, left: leftPos } : fixed && w ? { width: w, minWidth: w, maxWidth: w } : w ? { minWidth: w } : undefined}
      className={[
        "px-3 py-4 text-xs tabular-nums whitespace-nowrap",
        right ? "text-right" : "text-left",
        muted ? "text-a-ink-muted" : "text-a-ink",
        isSticky ? `sticky z-10 ${highlighted ? "bg-yellow-50 group-hover:bg-yellow-100/60" : "bg-white group-hover:bg-a-parchment"}` : "",
        isLast ? "shadow-[2px_0_5px_rgba(0,0,0,0.06)]" : "",
        groupStart ? "border-l border-a-divider" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}


function Sparkline({ stats, postId, onClick }: { stats: DailyStats[]; postId: string; onClick: () => void }) {
  const pts = stats.filter(s => pickMetric(s) != null).map(s => pickMetric(s) as number);
  if (pts.length < 2) return <button onClick={onClick} className="text-xs text-a-ink-muted">-</button>;
  const W = 72, H = 24, pad = 2;
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;
  const coords = pts.map((v, i) => [
    pad + (i / (pts.length - 1)) * (W - 2 * pad),
    pad + (1 - (v - min) / range) * (H - 2 * pad),
  ]);
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${coords[0][0]},${H} ` + line + ` ${coords[coords.length - 1][0]},${H}`;
  const gId = `sg-${postId}`;
  return (
    <button onClick={onClick} className="block hover:opacity-70 transition" title="트렌드 보기">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <linearGradient id={gId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.primary} stopOpacity="0.25" />
            <stop offset="100%" stopColor={CHART.primary} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gId})`} />
        <polyline points={line} fill="none" stroke={CHART.primary} strokeWidth="1.5"
          strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </button>
  );
}



type Props = {
  loading: boolean;
  posts: Post[];
  filteredPosts: Post[];
  sortedPosts: Post[];
  tableTotals: { delta: number; cost: number; views: number; reach: number; likes: number; comments: number; count: number; selectionMode: boolean };
  filters: Filters;
  hasFilter: boolean;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  editCell: EditCell | null;
  setEditCell: React.Dispatch<React.SetStateAction<EditCell | null>>;
  patchPost: (postId: string, field: string, value: string) => void;
  patchStat: (postId: string, measuredAt: string, field: "likes_count" | "comments_count", value: string) => void;
  patchPlayCount: (postId: string, value: string, measuredAt?: string | null) => void;
  editPlayCount: { postId: string; value: string } | null;
  setEditPlayCount: React.Dispatch<React.SetStateAction<{ postId: string; value: string } | null>>;
  selected: Set<string>;
  toggleSelectAll: () => void;
  handleRowCheck: (idx: number, id: string, e: React.MouseEvent) => void;
  sp: (col: string) => { onSort: () => void; sorted: "asc" | "desc" | null };
  startResize: (col: string, e: React.MouseEvent, isSticky?: boolean) => void;
  colWidths: Record<string, number>;
  stickyColWidths: Record<string, number>;
  stickyLefts: Record<string, number>;
  colSpan: number;
  copyIncrementList: () => void;
  deletePost: (id: string) => void;
  endPost: (id: string, end: boolean) => void;
  toast: (message: string, type?: "success" | "error" | "info") => void;
  setTrendPost: (post: Post) => void;
  updatedPlayCounts: Map<string, number | null>;
  hoverUpdatedId: string | null;
  setHoverUpdatedId: (id: string | null) => void;
  collectedAtLabel: string;
};

function PostsTable(props: Props) {
  const { loading, posts, filteredPosts, sortedPosts, tableTotals, filters, hasFilter, setFilters, editCell, setEditCell, patchPost, patchStat, patchPlayCount, editPlayCount, setEditPlayCount, selected, toggleSelectAll, handleRowCheck, sp, startResize, colWidths, stickyColWidths, stickyLefts, colSpan, copyIncrementList, deletePost, endPost, toast, setTrendPost, updatedPlayCounts, hoverUpdatedId, setHoverUpdatedId, collectedAtLabel } = props;

  // 가로 스크롤바를 표 맨 위(열제목 위)에도 둠 — 본문 스크롤과 양방향 동기화.
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bodyScrollRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const [scrollW, setScrollW] = useState(0);
  useEffect(() => {
    const body = bodyScrollRef.current, table = tableRef.current;
    if (!body || !table) return;
    const update = () => setScrollW(body.scrollWidth);
    update();
    const ro = new ResizeObserver(update); // 열 리사이즈/내용 변화 시 폭 재측정
    ro.observe(table);
    return () => ro.disconnect();
  }, [sortedPosts, colWidths, stickyColWidths, loading]);
  const syncFromTop = () => { if (bodyScrollRef.current && topScrollRef.current) bodyScrollRef.current.scrollLeft = topScrollRef.current.scrollLeft; };
  const syncFromBody = () => { if (bodyScrollRef.current && topScrollRef.current) topScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft; };

  return (
        <div className="bg-white rounded-[18px] border border-a-hairline overflow-hidden">
          {/* 상단 가로 스크롤바 (열제목 위) — 본문과 동기화 */}
          <div ref={topScrollRef} onScroll={syncFromTop} className="overflow-x-auto overflow-y-hidden">
            <div style={{ width: scrollW || 1, height: 1 }} />
          </div>
          <div ref={bodyScrollRef} onScroll={syncFromBody} className="overflow-auto max-h-[calc(100vh-120px)]">
          {loading ? (
            <div className="p-8 text-center text-a-ink-muted text-sm">로딩 중...</div>
          ) : (
            <table ref={tableRef} className="w-full text-sm">
              <thead className="sticky top-0 z-30">
                <tr className="border-b border-a-hairline">
                  <th className="pl-3 pr-1 py-3 sticky z-40 bg-white shadow-[inset_0_-1.5px_0_#d1d5db]" style={{ left: 0, width: 36, minWidth: 36 }}>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-a-blue cursor-pointer"
                      checked={filteredPosts.length > 0 && filteredPosts.every(p => selected.has(p.id))}
                      onChange={toggleSelectAll} />
                  </th>
                  <TH col="증분량" w={stickyColWidths["증분량"]} leftPos={stickyLefts["증분량"]} onResize={e => startResize("증분량", e, true)} right {...sp("증분량")}>증분량</TH>
                  <TH className="border-l border-a-divider" w={colWidths["채널분류"]} fixed onResize={e => startResize("채널분류", e)} {...sp("채널분류")}>
                    <span className="relative group/ct cursor-default">
                      채널 분류
                      <span className="hidden group-hover/ct:block absolute top-full left-0 mt-1 z-50 bg-gray-900 text-white text-[11px] rounded-[8px] px-3 py-2 whitespace-nowrap shadow-lg font-normal normal-case tracking-normal">
                        {CHANNEL_TYPES.map((t, i) => <span key={i} className="block">{fmtChannelType(t)}</span>)}
                      </span>
                    </span>
                  </TH>
                  <TH w={colWidths["게시일"]} onResize={e => startResize("게시일", e)} {...sp("게시일")}>게시일</TH>
                  <TH w={colWidths["인플루언서"]} fixed onResize={e => startResize("인플루언서", e)} {...sp("인플루언서")}>인플루언서</TH>
                  <TH w={colWidths["업체명"]} fixed onResize={e => startResize("업체명", e)} {...sp("업체명")}>업체명</TH>
                  <TH w={colWidths["상품명"]} fixed onResize={e => startResize("상품명", e)} {...sp("상품명")}>상품명</TH>
                  <TH w={colWidths["프로젝트명"]} fixed onResize={e => startResize("프로젝트명", e)} {...sp("프로젝트명")}>프로젝트명</TH>
                  <TH className="border-l border-a-divider" right w={colWidths["비용"]} onResize={e => startResize("비용", e)} {...sp("비용")}>비용(원)</TH>
                  <TH right w={colWidths["조회수"]} onResize={e => startResize("조회수", e)} {...sp("조회수")}>
                    <span className="group/views relative">
                      조회수
                      <div className="hidden group-hover/views:block absolute top-full right-0 mt-1.5 z-[9999] bg-white border border-a-hairline rounded-[10px] px-3 py-2 shadow-lg w-[210px] pointer-events-none text-left font-normal normal-case tracking-normal whitespace-normal text-[11px] text-a-ink-muted leading-relaxed">
                        바이럴(배너) 소재는 조회수 대신 <span className="font-semibold text-a-ink">도달수</span>가 합산됩니다.
                      </div>
                    </span>
                  </TH>
                  <TH right w={colWidths["조회당비용"]} onResize={e => startResize("조회당비용", e)} {...sp("조회당비용")}>
                    조회당비용(원)
                  </TH>
                  <TH right w={colWidths["도달수"]} onResize={e => startResize("도달수", e)} {...sp("도달수")}>
                    <span className="group/reach relative">
                      도달수
                      <div className="hidden group-hover/reach:block absolute top-full right-0 mt-1.5 z-[9999] bg-white border border-a-hairline rounded-[10px] px-3.5 py-3 shadow-lg min-w-[180px] pointer-events-none text-left font-normal normal-case tracking-normal">
                        <p className="text-[11px] text-a-ink-muted">조회수 × 80%로, 추정치입니다.</p>
                      </div>
                    </span>
                  </TH>
                  <TH right w={colWidths["도달당비용"]} onResize={e => startResize("도달당비용", e)} {...sp("도달당비용")}>도달당비용(원)</TH>
                  <TH className="border-l border-a-divider" w={colWidths["캡션"]} fixed onResize={e => startResize("캡션", e)}>캡션</TH>
                  <TH right w={colWidths["좋아요"]} onResize={e => startResize("좋아요", e)} {...sp("좋아요")}>좋아요</TH>
                  <TH right w={colWidths["댓글"]} onResize={e => startResize("댓글", e)} {...sp("댓글")}>댓글</TH>
                  <TH className="text-center" w={colWidths["트렌드"]} onResize={e => startResize("트렌드", e)}>트렌드</TH>
                  <TH w={colWidths["특이사항"]}>특이사항</TH>
                  <TH w={colWidths["삭제"]}></TH>
                </tr>
              </thead>
              <tbody>
                {/* 헤더 바로 아래 합계 행 — 체크박스로 선택한 행이 있으면 그 선택분 합계, 없으면 필터 적용 시 전체 합계 (조회당비용은 합계 안 함) */}
                {(tableTotals.selectionMode || hasFilter) && tableTotals.count > 0 && (
                  <tr className="border-y-2 border-a-blue/30 bg-blue-50 text-xs font-semibold">
                    <td className="pl-3 pr-1 py-2.5 sticky top-10 z-30 bg-blue-50" style={{ left: 0, width: 36, minWidth: 36 }} />
                    <td className="px-3 py-2.5 tabular-nums sticky top-10 z-30 bg-blue-50 group/cp" style={{ left: stickyLefts["증분량"], width: stickyColWidths["증분량"], minWidth: stickyColWidths["증분량"] }}>
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                        <span className={tableTotals.delta > 0 ? "text-red-500" : tableTotals.delta < 0 ? "text-blue-600" : "text-gray-400"}>
                          {tableTotals.delta > 0 ? "+" : ""}{tableTotals.delta.toLocaleString()}
                        </span>
                        <button type="button" onClick={copyIncrementList} title="계정·조회수/도달수 목록 복사 — 체크박스 선택이 있으면 선택분만, 없으면 필터 전체 (종료 게시물 제외)"
                          className="opacity-0 group-hover/cp:opacity-100 transition-opacity flex-shrink-0 text-a-ink-muted hover:text-a-blue">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-a-ink-muted whitespace-nowrap border-l border-a-divider sticky top-10 z-20 bg-blue-50">{tableTotals.selectionMode ? "선택 합계" : "합계"} ({tableTotals.count}건)</td>
                    <td className="sticky top-10 z-20 bg-blue-50" />{/* 게시일 */}
                    <td className="sticky top-10 z-20 bg-blue-50" />{/* 인플루언서 */}
                    <td className="sticky top-10 z-20 bg-blue-50" />{/* 업체명 */}
                    <td className="sticky top-10 z-20 bg-blue-50" />{/* 상품명 */}
                    <td className="sticky top-10 z-20 bg-blue-50" />{/* 프로젝트명 */}
                    <td className="px-3 py-2.5 text-right tabular-nums text-a-ink border-l border-a-divider sticky top-10 z-20 bg-blue-50">{tableTotals.cost.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-a-blue sticky top-10 z-20 bg-blue-50">{tableTotals.views.toLocaleString()}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-a-ink sticky top-10 z-20 bg-blue-50">{tableTotals.views > 0 ? (tableTotals.cost / tableTotals.views).toFixed(2) : "-"}</td>{/* 전체 평균 조회당비용 = 비용합계 ÷ 조회수합계 */}
                    <td className="px-3 py-2.5 text-right tabular-nums text-a-ink sticky top-10 z-20 bg-blue-50">{tableTotals.reach.toLocaleString()}</td>{/* 도달수 합계 */}
                    <td className="px-3 py-2.5 text-right tabular-nums text-a-ink sticky top-10 z-20 bg-blue-50">{tableTotals.reach > 0 ? (tableTotals.cost / tableTotals.reach).toFixed(2) : "-"}</td>{/* 전체 평균 도달당비용 = 비용합계 ÷ 도달수합계 */}
                    <td className="border-l border-a-divider sticky top-10 z-20 bg-blue-50" />{/* 캡션 */}
                    <td className="px-3 py-2.5 text-right tabular-nums text-a-ink sticky top-10 z-20 bg-blue-50">{tableTotals.likes.toLocaleString()}</td>{/* 좋아요 합계 */}
                    <td className="px-3 py-2.5 text-right tabular-nums text-a-ink sticky top-10 z-20 bg-blue-50">{tableTotals.comments.toLocaleString()}</td>{/* 댓글 합계 */}
                    <td className="sticky top-10 z-20 bg-blue-50" />{/* 트렌드 */}
                    <td className="sticky top-10 z-20 bg-blue-50" />{/* 특이사항 */}
                    <td className="sticky top-10 z-20 bg-blue-50" />{/* 삭제 */}
                  </tr>
                )}
                {sortedPosts.map((post, rowIdx) => {
                  // 🔒 필터 불변식: 값(현재/직전)은 lib.pickRangeStats 단일 구현으로 —
                  // 날짜 필터 시 범위 밖(latest_stats) 폴백 금지. 합계·정렬·복사·CSV와 반드시 동일 규칙.
                  const { s, prev } = pickRangeStats(post, filters.dateFrom, filters.dateTo);

                  const displayName = post.account_name ?? post.influencers?.name ?? "-";
                  const hl = hasNotableChange(post);
                  return (
                    <tr key={post.id} className={`group border-b border-a-divider last:border-0 transition-colors ${selected.has(post.id) ? "bg-blue-50/40" : hl ? "bg-yellow-50/60 hover:bg-yellow-100/50" : "hover:bg-a-parchment/60"}`}>
                      <td className="pl-3 pr-1 py-3 sticky z-10 bg-inherit" style={{ left: 0, width: 36, minWidth: 36 }}>
                        <input type="checkbox" className="w-3.5 h-3.5 accent-a-blue cursor-pointer"
                          checked={selected.has(post.id)} onChange={() => {}}
                          onClick={(e) => handleRowCheck(rowIdx, post.id, e)} />
                      </td>
                      <TD col="증분량" w={stickyColWidths["증분량"]} leftPos={stickyLefts["증분량"]} right highlighted={hl}>
                        {(() => {
                          if (viewIncrement(post, s, prev) == null) return <span className="text-gray-300">—</span>;
                          const delta = viewIncrement(post, s, prev) ?? 0;
                          return (
                            <span className={`font-semibold ${delta > 0 ? "text-red-500" : delta < 0 ? "text-blue-600" : "text-gray-300"}`}>
                              {delta > 0 ? "+" : ""}{delta.toLocaleString()}
                            </span>
                          );
                        })()}
                      </TD>
                      <TD muted groupStart fixed w={colWidths["채널분류"]}>
                        {editCell?.postId === post.id && editCell?.field === "channel_type" ? (
                          <select autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "channel_type", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "channel_type", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="text-xs bg-transparent border-b border-a-blue outline-none py-0.5 w-full">
                            <option value="">-</option>
                            {CHANNEL_TYPES.map(t => <option key={t} value={t}>{fmtChannelType(t)}</option>)}
                          </select>
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "channel_type", value: post.channel_type ?? "" })}
                            title={post.channel_type ? fmtChannelType(post.channel_type) : undefined}
                            className="block truncate cursor-text hover:text-a-blue transition-colors">
                            {post.channel_type ? fmtChannelType(post.channel_type) : "-"}
                          </span>
                        )}
                      </TD>
                      <TD muted w={colWidths["게시일"]}>
                        {editCell?.postId === post.id && editCell?.field === "posted_at" ? (
                          <input autoFocus type="date" value={editCell.value} min={MIN_ENTRY_DATE} max={maxDateKST()}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "posted_at", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "posted_at", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "posted_at", value: post.posted_at ?? "" })}
                            className="cursor-text hover:text-a-blue transition-colors">
                            {post.posted_at ?? "-"}
                          </span>
                        )}
                      </TD>
                      <TD w={colWidths["인플루언서"]} fixed>
                        {editCell?.postId === post.id && editCell?.field === "account_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "account_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "account_name", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <div className="flex items-center gap-1 min-w-0 overflow-hidden group/influencer">
                            {post.url ? (
                              <a href={post.url} target="_blank" rel="noreferrer"
                                className="font-medium text-left truncate min-w-0 hover:text-a-blue hover:underline transition-colors">
                                {displayName}
                              </a>
                            ) : (
                              <span className="font-medium text-left truncate min-w-0">{displayName}</span>
                            )}
                            {post.ended_at && (
                              <span title={`${post.ended_at} 이후 수집 중단 — 게시물 삭제 추정 (이전 데이터는 보존)`}
                                className="flex-shrink-0 text-[11px] leading-none px-1 py-0.5 rounded bg-gray-100 text-gray-400 border border-gray-200">종료</span>
                            )}
                            <button onClick={async () => {
                              try { await navigator.clipboard.writeText(post.url); toast("링크가 복사됐습니다.", "success"); } catch {}
                            }} className="opacity-0 group-hover/influencer:opacity-100 text-a-ink-muted hover:text-a-blue transition flex-shrink-0" title="링크 복사">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M9 3h6a2 2 0 012 2v0a2 2 0 01-2 2H9a2 2 0 01-2-2v0a2 2 0 012-2z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            <button onClick={() => setEditCell({ postId: post.id, field: "account_name", value: displayName === "-" ? "" : displayName })}
                              className="opacity-0 group-hover/influencer:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="이름 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </TD>
                      <TD muted w={colWidths["업체명"]} fixed>
                        {editCell?.postId === post.id && editCell?.field === "company_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "company_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "company_name", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (() => {
                          // 표시값 = 수동 업체명 우선, 없으면 계정→업체명 자동매핑. 편집 시작 시 이 표시값을 seed해 보이는 대로 수정 가능.
                          const company = post.company_name?.trim() || companyForAccount(post.account_name ?? post.influencers?.name) || "";
                          return (
                            <span onClick={() => setEditCell({ postId: post.id, field: "company_name", value: company })}
                              className="block truncate cursor-text hover:text-a-blue transition-colors">
                              {company || "-"}
                            </span>
                          );
                        })()}
                      </TD>
                      <TD muted w={colWidths["상품명"]} fixed>
                        {editCell?.postId === post.id && editCell?.field === "product_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "product_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "product_name", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "product_name", value: post.product_name ?? "" })}
                            title={post.product_name ?? undefined}
                            className="block truncate cursor-text hover:text-a-blue transition-colors">
                            {/* 매핑되면 제품코드 표시, 없으면 원본 상품명. 편집 시엔 원본 상품명 수정. */}
                            {productCodeOf(post.product_name) ?? post.product_name ?? "-"}
                          </span>
                        )}
                      </TD>
                      <TD muted w={colWidths["프로젝트명"]} fixed>
                        {editCell?.postId === post.id && editCell?.field === "project_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "project_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "project_name", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "project_name", value: post.project_name ?? "" })}
                            className="block truncate cursor-text text-a-ink-muted hover:text-a-blue transition-colors">
                            {post.project_name ?? "-"}
                          </span>
                        )}
                      </TD>
                      <td style={{ minWidth: colWidths["비용"] }}
                        className="px-3 py-4 text-xs tabular-nums text-right whitespace-nowrap cursor-text border-l border-a-divider"
                        onClick={() => editCell?.postId !== post.id && setEditCell({ postId: post.id, field: "cost", value: String(post.cost ?? "") })}>
                        {editCell?.postId === post.id && editCell?.field === "cost" ? (
                          <input autoFocus type="number" value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "cost", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "cost", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          <span className="text-a-ink-muted hover:text-a-blue transition-colors">
                            {post.cost != null ? post.cost.toLocaleString() : <span className="text-gray-300">—</span>}
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths["조회수"] }}
                        className="px-3 py-4 text-xs tabular-nums text-right whitespace-nowrap">
                        {editPlayCount?.postId === post.id ? (
                          <input autoFocus type="number" value={editPlayCount.value}
                            onChange={e => setEditPlayCount(v => v ? { ...v, value: e.target.value } : null)}
                            onBlur={() => patchPlayCount(post.id, editPlayCount.value, s?.measured_at)}
                            onKeyDown={e => { if (e.key === "Enter") patchPlayCount(post.id, editPlayCount.value, s?.measured_at); if (e.key === "Escape") setEditPlayCount(null); }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          <div className="flex items-center justify-end gap-1.5 relative">
                            <span onClick={() => setEditPlayCount({ postId: post.id, value: String(s?.play_count ?? "") })}
                              title="여기서 고치면 화면에 보이는 그 날짜 값으로 고정됩니다. 이후 자동수집은 계속되지만 이 값보다 낮아지지 않고, 더 높게 수집되면 그때 갱신됩니다. 시트에 더 나중에 입력한 값이 있으면 그 값이 우선합니다."
                              className="text-a-ink-muted hover:text-a-blue transition-colors cursor-text">
                              {(post.channel_type ?? "").includes("배너") ? <span className="text-gray-300">—</span> : fmt(s?.play_count)}
                            </span>
                            {updatedPlayCounts.has(post.id) && (
                              <div
                                className="w-1.5 h-1.5 bg-red-500 rounded-full cursor-pointer hover:w-2 hover:h-2 transition-all"
                                onMouseEnter={() => setHoverUpdatedId(post.id)}
                                onMouseLeave={() => setHoverUpdatedId(null)}
                                title="새로운 값 확인"
                              />
                            )}
                            {hoverUpdatedId === post.id && (
                              <div className="absolute bottom-full right-0 mb-2 bg-white border border-a-hairline rounded-[6px] px-2 py-1 text-xs whitespace-nowrap shadow-[0_4px_12px_rgba(0,0,0,0.10)] z-[80]">
                                <p className="font-semibold text-red-500">{collectedAtLabel}</p>
                                <p className="text-[11px] text-a-ink-muted mt-0.5">표에는 전일(어제)까지 반영 · 오늘 수집분은 다음날 노출</p>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <TD right muted w={colWidths["조회당비용"]}>
                        {!(post.channel_type ?? "").includes("배너") && post.cost != null && s?.play_count != null && s.play_count > 0
                          ? (post.cost / s.play_count).toFixed(2)
                          : <span className="text-gray-300">—</span>}
                      </TD>
                      <td style={{ minWidth: colWidths["도달수"] }}
                        className="px-3 py-4 text-xs tabular-nums text-right whitespace-nowrap cursor-text"
                        onClick={() => editCell?.postId !== post.id && setEditCell({ postId: post.id, field: "reach_count", value: String(post.reach_count ?? "") })}>
                        {editCell?.postId === post.id && editCell?.field === "reach_count" ? (
                          <input autoFocus type="number" value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "reach_count", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "reach_count", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          (() => {
                            const isBanner = (post.channel_type ?? "").includes("배너");
                            // 배너=일별 도달수(reach 우선, 없으면 입력값 1:1) — bannerDailyMetric 단일 규칙. 그 외=reach_count(없으면 조회수×0.8 추정).
                            const eff = isBanner ? bannerDailyMetric(s) : effectiveReach(post.reach_count, s?.play_count);
                            if (eff == null) return <span className="text-gray-300">—</span>;
                            const isAuto = !isBanner && post.reach_count == null;
                            return (
                              <span className={`hover:text-a-blue transition-colors ${isAuto ? "text-gray-400" : "text-a-ink-muted"}`}
                                title={isBanner ? "배너 도달수(시트 입력값)" : (isAuto ? "조회수의 80% 자동 추정" : undefined)}>
                                {eff.toLocaleString()}
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <TD right muted w={colWidths["도달당비용"]}>
                        {(() => {
                          const isBanner = (post.channel_type ?? "").includes("배너");
                          const eff = isBanner ? bannerDailyMetric(s) : effectiveReach(post.reach_count, s?.play_count);
                          return post.cost != null && eff != null && eff > 0
                            ? (post.cost / eff).toFixed(2)
                            : <span className="text-gray-300">—</span>;
                        })()}
                      </TD>
                      <TD muted groupStart w={colWidths["캡션"]} fixed>
                        {editCell?.postId === post.id && editCell?.field === "content_summary" ? (
                          <textarea
                            autoFocus
                            rows={2}
                            value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "content_summary", editCell.value)}
                            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="text-xs w-full bg-transparent border-b border-a-blue outline-none py-0.5 resize-none text-a-ink"
                          />
                        ) : (
                          <span
                            onClick={() => setEditCell({ postId: post.id, field: "content_summary", value: post.content_summary ?? "" })}
                            className="text-xs cursor-text text-a-ink-muted hover:text-a-ink transition-colors block"
                            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {post.content_summary || <span className="text-gray-300">—</span>}
                          </span>
                        )}
                      </TD>
                      <td style={{ minWidth: colWidths["좋아요"] }}
                        className="px-3 py-4 text-xs tabular-nums text-right whitespace-nowrap cursor-text text-a-ink-muted"
                        onDoubleClick={() => s && setEditCell({ postId: post.id, field: "likes_count", value: s.likes_count != null && s.likes_count >= 0 ? String(s.likes_count) : "", measuredAt: s.measured_at })}>
                        {editCell?.postId === post.id && editCell?.field === "likes_count" ? (
                          <input autoFocus type="number" value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchStat(post.id, editCell.measuredAt ?? "", "likes_count", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchStat(post.id, editCell.measuredAt ?? "", "likes_count", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          s?.likes_count == null ? <span className="text-gray-300">—</span>
                            : s.likes_count < 0 ? <span className="text-gray-400 text-[11px]" title="작성자가 좋아요 수를 숨김 (더블클릭해 수동 입력)">비공개</span>
                            : s.likes_count.toLocaleString()
                        )}
                      </td>
                      <td style={{ minWidth: colWidths["댓글"] }}
                        className="px-3 py-4 text-xs tabular-nums text-right whitespace-nowrap cursor-text text-a-ink-muted"
                        onDoubleClick={() => s && setEditCell({ postId: post.id, field: "comments_count", value: s.comments_count != null && s.comments_count >= 0 ? String(s.comments_count) : "", measuredAt: s.measured_at })}>
                        {editCell?.postId === post.id && editCell?.field === "comments_count" ? (
                          <input autoFocus type="number" value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchStat(post.id, editCell.measuredAt ?? "", "comments_count", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchStat(post.id, editCell.measuredAt ?? "", "comments_count", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          s?.comments_count == null ? <span className="text-gray-300">—</span>
                            : s.comments_count < 0 ? <span className="text-gray-400 text-[11px]" title="댓글 비공개/사용 안 함 (더블클릭해 수동 입력)">비공개</span>
                            : s.comments_count.toLocaleString()
                        )}
                      </td>
                      <td style={{ minWidth: colWidths["트렌드"] }} className="px-3 py-3 text-center">
                        <Sparkline stats={post.all_stats ?? []} postId={post.id} onClick={() => setTrendPost(post)} />
                      </td>
                      <td style={{ minWidth: colWidths["특이사항"] }} className="px-3 py-3 whitespace-nowrap">
                        {editCell?.postId === post.id && editCell?.field === "notes" ? (
                          <textarea
                            autoFocus
                            rows={2}
                            value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "notes", editCell.value)}
                            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="text-xs w-full bg-transparent border-b border-a-blue outline-none py-0.5 resize-none text-a-ink"
                          />
                        ) : (
                          <span
                            onClick={() => setEditCell({ postId: post.id, field: "notes", value: post.notes ?? "" })}
                            className="text-xs cursor-text text-a-ink-muted hover:text-a-ink transition-colors whitespace-nowrap"
                          >
                            {post.notes || <span className="text-gray-300">—</span>}
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths["삭제"] }} className="px-3 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={() => setEditCell({ postId: post.id, field: "project_name", value: post.project_name ?? "" })}
                          className="text-a-ink-muted hover:text-a-ink transition opacity-0 group-hover:opacity-100 mr-2"
                          title="수정">
                          <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                            <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <button onClick={() => endPost(post.id, !post.ended_at)}
                          className="text-a-ink-muted hover:text-a-ink text-xs transition opacity-0 group-hover:opacity-100 mr-2"
                          title={post.ended_at ? "트래킹 종료 해제" : "트래킹 종료 (자동 수집 제외, 기존 데이터 보존)"}>
                          {post.ended_at ? "종료 해제" : "종료"}</button>
                        <button onClick={() => deletePost(post.id)}
                          className="text-a-ink-muted hover:text-red-500 text-xs transition opacity-0 group-hover:opacity-100">삭제</button>
                      </td>
                    </tr>
                  );
                })}
                {posts.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} className="px-5 py-14 text-center">
                      <p className="text-sm font-medium text-a-ink mb-1">추적 중인 협찬 게시물이 없습니다</p>
                      <p className="text-xs text-a-ink-muted">상단 '+ 게시물 추가' 버튼으로 협찬 게시물을 등록하세요.</p>
                    </td>
                  </tr>
                )}
                {posts.length > 0 && filteredPosts.length === 0 && (
                  <tr>
                    <td colSpan={colSpan} className="px-5 py-12 text-center">
                      <p className="text-sm text-a-ink-muted mb-2">필터 조건에 맞는 게시물이 없습니다.</p>
                      <button onClick={() => setFilters(INIT_FILTERS)}
                        className="text-xs text-a-blue hover:underline">필터 초기화</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          </div>
        </div>
  );
}

// 핸들러 props가 부모에서 정체성 고정(useStableHandlers)되어 있어, 데이터 props가 안 바뀌면
// 부모 리렌더 시에도 표 전체(모든 행+미니그래프)를 다시 그리지 않음.
export default memo(PostsTable);
