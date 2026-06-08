"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";

type DailyStats = {
  measured_at: string;
  play_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
};

type Post = {
  id: string;
  url: string;
  posted_at: string | null;
  product_name: string | null;
  project_name: string | null;
  account_name: string | null;
  channel_type: string | null;
  cost: number | null;
  reach_count: number | null;
  notes: string | null;
  content_summary: string | null;
  created_at: string;
  influencers: { id: string; name: string; platform: string; post_type: string | null; category?: string | null } | null;
  latest_stats: DailyStats | null;
  prev_stats: DailyStats | null;
  all_stats: DailyStats[];
};

type CsvRow = { url: string; project_name: string | null; product_name: string | null; channel_type: string | null; account_name: string | null; posted_at: string | null; cost: number | null; reach_count: number | null };

type Filters = { name: string; project: string; products: string[]; type: string; channelTypes: string[]; dateFrom: string; dateTo: string; postedFrom: string; postedTo: string };
const INIT_FILTERS: Filters = { name: "", project: "", products: [], type: "all", channelTypes: [], dateFrom: "", dateTo: "", postedFrom: "", postedTo: "" };
type EditCell = { postId: string; field: "project_name" | "product_name" | "channel_type" | "cost" | "reach_count" | "account_name" | "posted_at" | "notes" | "content_summary"; value: string };
const POST_TYPES = ["릴스", "피드", "숏폼", "롱폼"];
const CHANNEL_TYPES = [
  "바이럴(배너)",
  "바이럴(영상)",
  "협찬(먹스타)",
  "협찬(인플루언서)",
  "협찬(파워채널/매거진)",
];
const CATEGORIES = [
  { value: "A",   desc: "찐팬서사 (꾸준함)" },
  { value: "B",   desc: "선망성" },
  { value: "C",   desc: "맛잘알" },
  { value: "D",   desc: "친근감" },
  { value: "기타", desc: "기타" },
];

/**
 * 재발방지: 필터 범위 유틸리티
 *
 * 문제: chartData, dailyTotals, 게시물 증분 등이 서로 다른 범위의 데이터 사용
 * 해결: 모든 데이터 계산이 이 함수를 통해 필터 범위를 일관되게 적용
 */
function isStatInDateRange(stat: DailyStats, dateFrom: string, dateTo: string): boolean {
  if (dateFrom && stat.measured_at < dateFrom) return false;
  if (dateTo && stat.measured_at > dateTo) return false;
  return true;
}

function getFilteredStats(allStats: DailyStats[], dateFrom: string, dateTo: string): DailyStats[] {
  return allStats.filter(s => isStatInDateRange(s, dateFrom, dateTo));
}

function fmt(v: number | null | undefined) {
  return v == null ? "-" : v.toLocaleString();
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeChannelType(value: string | null): string | null {
  if (!value) return null;
  // 공백 정규화: 연속된 공백을 단일 공백으로, 앞뒤 공백 제거
  return value.trim().replace(/\s+/g, " ");
}

function updatePostLatestStats(post: Post, now: string, overrides?: Partial<DailyStats>): DailyStats | null {
  if (!post.latest_stats) {
    return {
      measured_at: now,
      play_count: overrides?.play_count ?? null,
      likes_count: overrides?.likes_count ?? null,
      comments_count: overrides?.comments_count ?? null,
    };
  }
  return {
    ...post.latest_stats,
    measured_at: now,
    play_count: overrides?.play_count ?? post.latest_stats.play_count,
    likes_count: overrides?.likes_count ?? post.latest_stats.likes_count,
    comments_count: overrides?.comments_count ?? post.latest_stats.comments_count,
  };
}

function getPostType(url: string): string {
  if (url.includes("instagram.com")) return url.includes("/reel/") ? "릴스" : "피드";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return url.includes("/shorts/") ? "숏폼" : "롱폼";
  return "-";
}

const STICKY_COL_ORDER = ["증분량"] as const;

function getThumbnailUrl(url: string): string | null {
  let m = url.match(/youtube\.com\/shorts\/([^/?&#]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  m = url.match(/[?&]v=([^&]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  m = url.match(/youtu\.be\/([^/?#]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  return null;
}

function isRecentPost(postedAt: string | null): boolean {
  if (!postedAt) return false;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  return postedAt.slice(0, 10) >= yesterdayStr && postedAt.slice(0, 10) <= todayStr;
}

function hasNotableChange(post: Post): boolean {
  const l = post.latest_stats, p = post.prev_stats;
  if (!l || !p) return false;
  return (l.play_count ?? 0) > (p.play_count ?? 0) || (l.comments_count ?? 0) > (p.comments_count ?? 0);
}

function TH({ children, right, col, onSort, sorted, className: cls, w, leftPos, onResize }: {
  children?: React.ReactNode; right?: boolean; col?: string;
  onSort?: () => void; sorted?: "asc" | "desc" | null; className?: string;
  w?: number; leftPos?: number; onResize?: (e: React.MouseEvent) => void;
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
      style={isSticky ? { width: w, minWidth: w, left: leftPos } : w ? { minWidth: w } : undefined}
      className={[
        "relative px-3 py-3 text-xs font-medium whitespace-nowrap select-none",
        right ? "text-right" : "text-left",
        sortable ? `cursor-pointer transition-colors ${sorted ? "text-a-ink" : "text-a-ink-muted hover:text-a-ink"}` : "text-a-ink-muted",
        isSticky ? "sticky z-40 bg-white" : "bg-white",
        isLast ? "shadow-[2px_0_5px_rgba(0,0,0,0.06)]" : "",
        cls ?? "",
      ].join(" ")}
    >
      {children}
      {sortable && <span className={`ml-1 ${sorted ? "text-a-blue" : "opacity-20"}`}>{sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}</span>}
      {onResize && (
        <div
          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-a-blue/30"
          onMouseDown={e => { e.stopPropagation(); onResize(e); }}
        />
      )}
    </th>
  );
}

function TD({ children, right, muted, col, highlighted, w, leftPos }: {
  children: React.ReactNode; right?: boolean; muted?: boolean; col?: string; highlighted?: boolean;
  w?: number; leftPos?: number;
}) {
  const isSticky = col !== undefined;
  const isLast = col === "증분량";
  return (
    <td
      style={isSticky ? { width: w, minWidth: w, left: leftPos } : w ? { minWidth: w } : undefined}
      className={[
        "px-3 py-4 text-xs tabular-nums whitespace-nowrap",
        right ? "text-right" : "text-left",
        muted ? "text-a-ink-muted" : "text-a-ink",
        isSticky ? `sticky z-10 ${highlighted ? "bg-yellow-50 group-hover:bg-yellow-100/60" : "bg-white group-hover:bg-a-parchment"}` : "",
        isLast ? "shadow-[2px_0_5px_rgba(0,0,0,0.06)]" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
}

function getCategoryLabel(val: string | null | undefined): string {
  if (!val) return "-";
  const cat = CATEGORIES.find(c => c.value === val);
  return cat ? cat.desc : val;
}

function pickMetric(s: DailyStats): number | null {
  return s.play_count ?? s.likes_count;
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
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <polygon points={area} fill={`url(#${gId})`} />
        <polyline points={line} fill="none" stroke="#3b82f6" strokeWidth="1.5"
          strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function smoothCurvePath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0][0]},${pts[0][1]} L ${pts[1][0]},${pts[1][1]}`;
  const t = 0.35;
  let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) * t;
    const cp1y = p1[1] + (p2[1] - p0[1]) * t;
    const cp2x = p2[0] - (p3[0] - p1[0]) * t;
    const cp2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

function LineChart({ data, height = 160, gradId = "lcGrad", postsOnDate, lsData, secondaryData, secondaryColor = "#ea580c" }: {
  data: { date: string; value: number }[];
  height?: number;
  gradId?: string;
  postsOnDate?: (date: string) => { name: string; url: string }[];
  lsData?: { date: string; ratio: number; value: number | null }[];
  secondaryData?: { date: string; value: number }[];
  secondaryColor?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeIdx = pinnedIdx ?? hoverIdx;
  if (data.length < 2) return <div className="flex items-center justify-center py-8 text-xs text-a-ink-muted">데이터 없음</div>;
  const pl = 52, pr = 8, pt = 8, pb = 22;
  const VW = 560, VH = height;
  const cw = VW - pl - pr, ch = VH - pt - pb;
  const vals = data.map(d => d.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const xS = (i: number) => (i / (data.length - 1)) * cw;
  const yS = (v: number) => ch - ((v - min) / range) * ch;
  const pts: [number, number][] = data.map((d, i) => [xS(i), yS(d.value)]);
  const linePath = smoothCurvePath(pts);
  const areaPath = `${linePath} L ${xS(data.length - 1).toFixed(2)},${ch} L 0,${ch} Z`;
  const yTicks = [0, 0.5, 1].map(t => min + t * range);
  const step = Math.max(1, Math.ceil(data.length / 6));
  const xLabelIdxs = data.map((_, i) => i).filter(i => i % step === 0 || i === data.length - 1);
  const fmtY = (v: number) => v >= 10000 ? `${Math.round(v / 10000)}만` : v >= 1000 ? `${Math.round(v / 1000)}천` : Math.round(v).toLocaleString();
  const cellW = cw / Math.max(1, data.length - 1);

  const hoveredDate = activeIdx !== null ? data[activeIdx].date : null;
  const hoveredPosts = hoveredDate && postsOnDate ? postsOnDate(hoveredDate) : [];

  // 라라스윗 검색량 점선 — 데이터 날짜를 주 차트에 맞춰 매핑 후 독립 정규화
  const lsPath = (() => {
    if (!lsData || lsData.length === 0) return null;
    const lsMap = new Map(lsData.map(d => [d.date, d.ratio]));
    const mapped = data.map((d, i) => ({ i, ratio: lsMap.get(d.date) ?? null })).filter(p => p.ratio !== null) as { i: number; ratio: number }[];
    if (mapped.length < 2) return null;
    const ratios = mapped.map(p => p.ratio);
    const lsMin = Math.min(...ratios), lsMax = Math.max(...ratios);
    const lsRange = lsMax - lsMin || 1;
    const lsY = (r: number) => ch - ((r - lsMin) / lsRange) * ch;
    return mapped.map((p, j) => `${j === 0 ? "M" : "L"}${xS(p.i).toFixed(1)},${lsY(p.ratio).toFixed(1)}`).join(" ");
  })();

  const hoveredLsEntry = (() => {
    if (!lsData || activeIdx === null) return null;
    return lsData.find(d => d.date === data[activeIdx].date) ?? null;
  })();

  // Secondary data (오른쪽 Y축)
  const secondaryPath = (() => {
    if (!secondaryData || secondaryData.length === 0) {
      console.log("[광고비] 데이터 없음");
      return null;
    }
    // 날짜 정규화: YYYY-MM-DD 형식만 추출 (시간 부분 제거)
    const normalizeDate = (d: string): string => d.split('T')[0];
    const secMap = new Map(secondaryData.map(d => [normalizeDate(d.date), d.value]));
    console.log("[광고비] secMap:", Array.from(secMap.entries()));
    const secVals = data.map(d => secMap.get(normalizeDate(d.date))).filter(v => v != null) as number[];
    console.log("[광고비] 매칭 데이터:", secVals.length, "/", data.length);
    if (secVals.length < 1) {
      console.log("[광고비] 매칭 데이터 없음");
      return null;
    }
    if (secVals.length < 2) {
      console.log("[광고비] 데이터 1개만 있음 (최소값 = 최대값으로 처리)");
    }
    const secMin = Math.min(...secVals), secMax = Math.max(...secVals);
    const secRange = secMax - secMin || 1;
    const secYS = (v: number) => ch - ((v - secMin) / secRange) * ch;
    // secondaryData가 있는 모든 점을 포함 (필터링 안 함)
    const secPts: [number, number][] = data.map((d, i) => {
      const v = secMap.get(normalizeDate(d.date));
      if (v == null) return null as any;
      return [xS(i), secYS(v)];
    }).filter(p => p !== null);
    if (secPts.length === 0) return null;
    if (secPts.length === 1) {
      // 1개 포인트: 점 표시용 경로 (반경 2px 원)
      const [x, y] = secPts[0];
      return `M ${x} ${y - 2} A 2 2 0 0 1 ${x} ${y + 2} A 2 2 0 0 1 ${x} ${y - 2}`;
    }
    return smoothCurvePath(secPts as [number, number][]);
  })();

  const secondaryTicks = (() => {
    if (!secondaryData || secondaryData.length === 0) return null;
    // 날짜 정규화: YYYY-MM-DD 형식만 추출 (시간 부분 제거)
    const normalizeDate = (d: string): string => d.split('T')[0];
    const secMap = new Map(secondaryData.map(d => [normalizeDate(d.date), d.value]));
    const secVals = data.map(d => secMap.get(normalizeDate(d.date))).filter(v => v != null) as number[];
    if (secVals.length === 0) return null;
    const secMin = Math.min(...secVals), secMax = Math.max(...secVals);
    const secRange = secMax - secMin || 1;
    const secYS = (v: number) => ch - ((v - secMin) / secRange) * ch;
    return [0, 0.5, 1].map(t => ({ val: secMin + t * secRange, y: secYS(secMin + t * secRange) }));
  })();

  const fmtYSecondary = (v: number) => {
    if (v >= 10000000) return `${(v / 10000000).toFixed(1)}천만`;
    if (v >= 1000000) return `${(v / 1000000).toFixed(1)}백만`;
    if (v >= 10000) return `${Math.round(v / 10000)}만`;
    if (v >= 1000) return `${Math.round(v / 1000)}천`;
    return Math.round(v).toLocaleString();
  };

  const hoveredSecondaryValue = (() => {
    if (!secondaryData || activeIdx === null) return null;
    // 날짜 정규화: YYYY-MM-DD 형식만 비교
    const normalizeDate = (d: string): string => d.split('T')[0];
    const hoveredDate = normalizeDate(data[activeIdx].date);
    return secondaryData.find(d => normalizeDate(d.date) === hoveredDate)?.value ?? null;
  })();

  return (
    <div className="relative w-full">
      <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ overflow: "visible" }}
        onMouseLeave={(e) => {
          // 툴팁 위로 이동한 경우 hoverIdx 유지 (pinnedIdx가 처리)
          if (tooltipRef.current?.contains(e.relatedTarget as Node)) return;
          setHoverIdx(null);
          setPinnedIdx(null);
        }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform={`translate(${pl},${pt})`}>
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line x1={0} y1={yS(tick)} x2={cw} y2={yS(tick)} stroke="#e5e7eb" strokeWidth="1" strokeDasharray="4,4" />
              <text x={-8} y={yS(tick)} textAnchor="end" dominantBaseline="middle" fontSize="7" fill="#9ca3af">{fmtY(tick)}</text>
            </g>
          ))}
          {secondaryTicks && secondaryTicks.map((tick, i) => (
            <g key={`sec-${i}`} opacity="0">
              <text x={cw + 8} y={tick.y} textAnchor="start" dominantBaseline="middle" fontSize="6" fill="#666666">{fmtYSecondary(tick.val)}</text>
            </g>
          ))}
          <path d={areaPath} fill={`url(#${gradId})`} />
          {lsPath && <path d={lsPath} fill="none" stroke="#d1d5db" strokeWidth="1" strokeDasharray="3 2" />}
          <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="1.5"
            strokeLinejoin="round" strokeLinecap="round" />
          {secondaryPath && (
            <path d={secondaryPath} fill="none" stroke={secondaryColor} strokeWidth="1"
              strokeLinejoin="round" strokeLinecap="round" />
          )}
          {data.map((_, i) => (
            <rect key={i} x={Math.max(0, xS(i) - cellW / 2)} y={0}
              width={cellW} height={ch} fill="transparent"
              onMouseEnter={() => { setHoverIdx(i); setPinnedIdx(null); }} />
          ))}
          {activeIdx !== null && (
            <>
              <line x1={xS(activeIdx)} y1={0} x2={xS(activeIdx)} y2={ch}
                stroke="#3b82f6" strokeWidth="1" strokeDasharray="3,3" />
              <circle cx={xS(activeIdx)} cy={yS(data[activeIdx].value)} r={3.5} fill="#3b82f6" />
            </>
          )}
          {xLabelIdxs.map(i => (
            <text key={i} x={xS(i)} y={ch + 14} textAnchor="middle" fontSize="7" fill="#9ca3af">
              {data[i].date.slice(5).replace("-", "/")}
            </text>
          ))}
        </g>
      </svg>
      {activeIdx !== null && (
        <div ref={tooltipRef}
          className="absolute top-1 bg-white border border-a-hairline rounded-[10px] px-3.5 py-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.10)] text-xs z-20 min-w-[200px]"
          style={{ left: `${Math.min(Math.max(((pl + xS(activeIdx)) / VW) * 100, 15), 85)}%`, transform: "translateX(-50%)" }}
          onMouseEnter={() => setPinnedIdx(activeIdx)}
          onMouseLeave={() => { setPinnedIdx(null); setHoverIdx(null); }}>
          <p className="text-a-ink-muted mb-1">{data[activeIdx].date.replace(/-/g, ".")} · <span className="font-semibold text-a-blue tabular-nums">{data[activeIdx].value.toLocaleString()}</span></p>
          {hoveredSecondaryValue != null && (
            <p className="text-orange-600 tabular-nums">전체 전환 광고비: {hoveredSecondaryValue.toLocaleString()}원</p>
          )}
          {hoveredLsEntry?.value != null && (
            <p className="text-gray-400 tabular-nums">라라스윗 검색량: {hoveredLsEntry.value.toLocaleString()}</p>
          )}
          {hoveredPosts.length > 0 && (
            <div className="border-t border-a-hairline pt-1.5 mt-1 space-y-0.5 max-h-24 overflow-y-auto">
              {hoveredPosts.map((p, i) => (
                <div key={i}>
                  <a href={p.url} target="_blank" rel="noreferrer"
                    className="text-a-ink font-medium pointer-events-auto hover:text-a-blue hover:underline transition-colors">
                    {p.name}
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function MonitoringPage() {
  const { toasts, show: toast } = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showChannelTypeDropdown, setShowChannelTypeDropdown] = useState(false);
  const [form, setForm] = useState({ url: "", product_name: "", project_name: "", channel_type: "", cost: "" });
  const [adding, setAdding] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [filters, setFilters] = useState<Filters>(INIT_FILTERS);
  const [dateTooltip, setDateTooltip] = useState<{ date: string; x: number; y: number } | null>(null);
  const [lsSearchData, setLsSearchData] = useState<{ date: string; ratio: number; value: number | null }[]>([]);
  const [brandMetrics, setBrandMetrics] = useState<{ measured_at: string; yt_views: number | null; yt_unique_viewers: number | null; yt_search_views: number | null; ig_profile_views: number | null; ig_reach: number | null }[]>([]);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showHelp, setShowHelp] = useState(false);
  const [trendPost, setTrendPost] = useState<Post | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [editCell, setEditCell] = useState<EditCell | null>(null);
  const [editCategory, setEditCategory] = useState<{ postId: string; infId: string; value: string } | null>(null);
  const [editPlayCount, setEditPlayCount] = useState<{ postId: string; value: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showTimeoutError, setShowTimeoutError] = useState(false);
  const [updatedPlayCounts, setUpdatedPlayCounts] = useState<Map<string, number | null>>(new Map());
  const [hoverUpdatedId, setHoverUpdatedId] = useState<string | null>(null);
  const [mainAdCosts, setMainAdCosts] = useState<{ date: string; total_cost: number }[]>([]);
  const previousPlayCountsRef = useRef<Map<string, number | null>>(new Map());
  const runningJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // column widths for drag-resize
  const [stickyColWidths, setStickyColWidths] = useState<Record<string, number>>({
    "증분량": 80,
  });
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    "채널분류": 100, "게시일": 104, "캡션": 40, "인플루언서": 80, "상품명": 150, "프로젝트명": 150, "비용": 120, "조회수": 100, "조회당비용": 110, "도달수": 100, "도달당비용": 110, "좋아요": 80, "댓글": 80, "트렌드": 90, "특이사항": 160, "삭제": 60,
  });
  const resizingRef = useRef<{ col: string; startX: number; startW: number; isSticky: boolean } | null>(null);

  const filteredPosts = posts.filter(post => {
    const displayName = (post.account_name ?? post.influencers?.name ?? "").toLowerCase();

    // 제로비 판정: 조회수가 없거나 0
    const isZeroPost = !post.latest_stats || post.latest_stats.play_count === 0 || post.latest_stats.play_count == null;

    // 1️⃣ 모든 게시물에 적용되는 필터 (제로비도 포함)
    if (filters.name && !displayName.includes(filters.name.toLowerCase())) return false;
    if (filters.project && !(post.project_name ?? "").toLowerCase().includes(filters.project.toLowerCase())) return false;
    if (filters.products.length > 0 && !filters.products.includes(post.product_name ?? "")) return false;
    if (filters.type !== "all" && getPostType(post.url) !== filters.type) return false;
    if (filters.channelTypes.length > 0 && !filters.channelTypes.some(ct => (post.channel_type ?? "").replace(/\s+/g, "") === ct.replace(/\s+/g, ""))) return false;

    // 게시일 필터 (posted_at 기준) - 제로비는 제외
    if (!isZeroPost) {
      if (filters.postedFrom && (!post.posted_at || post.posted_at < filters.postedFrom)) return false;
      if (filters.postedTo && (!post.posted_at || post.posted_at > filters.postedTo)) return false;
    }

    // 2️⃣ 날짜 필터: 제로비는 제외 (조회수 데이터가 없으므로)
    if (!isZeroPost && (filters.dateFrom || filters.dateTo)) {
      const hasData = (post.all_stats ?? []).some(s =>
        (!filters.dateFrom || s.measured_at >= filters.dateFrom) &&
        (!filters.dateTo   || s.measured_at <= filters.dateTo)
      );
      if (!hasData) return false;
    }

    return true;
  });

  const productOptions = Array.from(
    new Set(posts.map(p => p.product_name).filter((p): p is string => Boolean(p)))
  ).sort();

  const hasFilter = filters.name !== "" || filters.project !== "" || filters.products.length > 0 || filters.type !== "all" || filters.channelTypes.length > 0 || filters.dateFrom !== "" || filters.dateTo !== "" || filters.postedFrom !== "" || filters.postedTo !== "";
  const colSpan = 17;

  const lastMonitoredAt = posts.length > 0
    ? posts.reduce((latest, p) => {
        const t = p.latest_stats?.measured_at ?? p.created_at;
        return t > latest ? t : latest;
      }, posts[0].latest_stats?.measured_at ?? posts[0].created_at)
    : null;

  const formatLastUpdate = (dateStr: string): string => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}일 전`;
    if (diffHours > 0) return `${diffHours}시간 전`;
    return "방금";
  };

  const chartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const post of filteredPosts) {
      // ⚠️ 재발방지: getFilteredStats() 사용해서 날짜 범위 일관성 보장
      const filteredStats = getFilteredStats(post.all_stats ?? [], filters.dateFrom, filters.dateTo);
      for (const s of filteredStats) {
        const v = pickMetric(s);
        if (v != null) map.set(s.measured_at, (map.get(s.measured_at) ?? 0) + v);
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  }, [filteredPosts, filters]);

  const totalPlayCount = filteredPosts.reduce((s, p) => s + (p.latest_stats?.play_count ?? 0), 0);
  const totalLikes = filteredPosts.reduce((s, p) => s + (p.latest_stats?.likes_count ?? 0), 0);
  const totalComments = filteredPosts.reduce((s, p) => s + (p.latest_stats?.comments_count ?? 0), 0);

  const dailyTotals = useMemo(() => {
    // ⚠️ 재발방지: getFilteredStats() 사용해서 필터 범위 일관성 보장
    // 전체 날짜 목록 수집 (필터 범위 내만)
    const allDatesSet = new Set<string>();
    for (const post of filteredPosts) {
      const filteredStats = getFilteredStats(post.all_stats ?? [], filters.dateFrom, filters.dateTo);
      for (const s of filteredStats) {
        allDatesSet.add(s.measured_at);
      }
    }
    const allDates = [...allDatesSet].sort();
    if (allDates.length === 0) return [];

    const totals = new Map<string, { play: number; likes: number; comments: number }>(
      allDates.map(d => [d, { play: 0, likes: 0, comments: 0 }])
    );

    for (const post of filteredPosts) {
      // ⚠️ 재발방지: getFilteredStats() 사용해서 필터 범위 일관성 보장
      const filteredStats = getFilteredStats(post.all_stats ?? [], filters.dateFrom, filters.dateTo);
      const statsMap = new Map(filteredStats.map(s => [s.measured_at, s]));

      // Forward-fill: 필터 범위 내에서만 데이터 없는 날은 이전 마지막 값 유지
      // null은 데이터 없음(기여 0)
      let lastPlay: number | null = null, lastLikes: number | null = null, lastComments: number | null = null;
      for (const date of allDates) {
        if (statsMap.has(date)) {
          const s = statsMap.get(date)!;
          lastPlay     = s.play_count     ?? lastPlay;
          lastLikes    = s.likes_count    ?? lastLikes;
          lastComments = s.comments_count ?? lastComments;
        }
        const e = totals.get(date)!;
        totals.set(date, {
          play:     e.play     + (lastPlay     ?? 0),
          likes:    e.likes    + (lastLikes    ?? 0),
          comments: e.comments + (lastComments ?? 0),
        });
      }
    }

    return allDates.map(date => ({ date, ...totals.get(date)! }));
  }, [filteredPosts]);

  const deltaChartData = useMemo(() => {
    return chartData.slice(1).map((d, i) => ({
      date: d.date,
      value: d.value - chartData[i].value,
    }));
  }, [chartData]);

  const deltaTableData = useMemo(() => {
    if (dailyTotals.length < 2) return [];
    const lsMap = new Map((lsSearchData || []).map(d => [d.date, d.value ?? 0]));
    return dailyTotals.slice(1).map((d, i) => ({
      date:     d.date,
      play:     d.play     - dailyTotals[i].play,
      search:   ((lsMap.get(d.date) ?? 0) - (lsMap.get(dailyTotals[i].date) ?? 0)) || 0,
      comments: d.comments - dailyTotals[i].comments,
    }));
  }, [dailyTotals, lsSearchData]);

  // 날짜별 채널타입(바이럴/협찬) 조회수 증분 — forward-fill 적용
  const typeBreakdownByDate = useMemo(() => {
    if (dailyTotals.length < 2) return new Map<string, Record<string, number>>();
    const dates = dailyTotals.map(d => d.date);
    // O(M×S) 인덱스 빌드: post별 date→play_count Map (forward-fill)
    const postIndex = filteredPosts.map(post => {
      const group = (() => { const ct = post.channel_type ?? '기타'; return ct.startsWith('바이럴') ? '바이럴' : ct.startsWith('협찬') ? '협찬' : '기타'; })();
      const rawMap = new Map((post.all_stats ?? []).map(s => [s.measured_at, s.play_count]));
      // 날짜 순서로 forward-fill
      const byDate = new Map<string, number>();
      let last = 0;
      for (const date of dates) {
        if (rawMap.has(date)) last = rawMap.get(date) ?? last;
        byDate.set(date, last);
      }
      return { group, byDate };
    });
    const result = new Map<string, Record<string, number>>();
    for (let di = 1; di < dates.length; di++) {
      const date = dates[di], prevDate = dates[di - 1];
      const byType: Record<string, number> = {};
      for (const { group, byDate } of postIndex) {
        const delta = (byDate.get(date) ?? 0) - (byDate.get(prevDate) ?? 0);
        byType[group] = (byType[group] ?? 0) + delta;
      }
      result.set(date, byType);
    }
    return result;
  }, [dailyTotals, filteredPosts]);

  // derive sticky left positions from current widths
  const stickyLefts = useMemo(() => {
    let left = 0;
    const result: Record<string, number> = {};
    for (const col of STICKY_COL_ORDER) {
      result[col] = left;
      left += stickyColWidths[col];
    }
    return result;
  }, [stickyColWidths]);

  const { lsStartDate, lsEndDate } = useMemo(() => ({
    lsStartDate: chartData.length >= 2 ? chartData[0].date : null,
    lsEndDate: chartData.length >= 2 ? chartData[chartData.length - 1].date : null,
  }), [chartData]);

  useEffect(() => {
    if (!lsStartDate || !lsEndDate) return;
    const controller = new AbortController();
    fetch(`/api/larasweet-trend?startDate=${lsStartDate}&endDate=${lsEndDate}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : { data: [] })
      .then(json => setLsSearchData(json.data ?? []))
      .catch(() => {});
    return () => controller.abort();
  }, [lsStartDate, lsEndDate]);

  useEffect(() => {
    fetch("/api/brand-metrics")
      .then(r => r.ok ? r.json() : [])
      .then(data => setBrandMetrics(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadPosts().finally(() => setLoading(false));
    checkAndResumeMonitoring();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // 메인 차트용 광고비 데이터 로드
  useEffect(() => {
    if (chartData.length < 2) {
      setMainAdCosts([]);
      return;
    }

    // 날짜 안전하게 추출 (YYYY-MM-DD 형식)
    const extractDate = (dateStr: any): string => {
      if (typeof dateStr !== 'string') return '';
      return dateStr.split('T')[0]; // ISO 형식에서 날짜만 추출
    };

    const dateFrom = extractDate(chartData[0].date);
    const dateTo = extractDate(chartData[chartData.length - 1].date);

    if (!dateFrom || !dateTo) {
      setMainAdCosts([]);
      return;
    }

    const url = new URL('/api/meta-ads', window.location.origin);
    url.searchParams.set('date_from', dateFrom);
    url.searchParams.set('date_to', dateTo);

    console.log("[광고비 API 요청]", url.toString());

    fetch(url.toString())
      .then(r => {
        if (!r.ok) {
          throw new Error(`Meta API 오류: ${r.status} ${r.statusText}`);
        }
        return r.json();
      })
      .then(data => {
        console.log("[광고비 API 응답]", data);
        if (Array.isArray(data)) {
          console.log("[광고비 데이터]", data.length, "건 수신");
          setMainAdCosts(data);
        } else {
          console.error("[광고비 로드] 예상치 못한 응답 형식:", data);
          setMainAdCosts([]);
        }
      })
      .catch(err => {
        console.error("[광고비 로드 오류]", err.message || err);
        setMainAdCosts([]);
      });
  }, [chartData]);


  async function loadPosts() {
    const res = await fetch("/api/sponsored-posts");
    if (!res.ok) {
      toast("데이터 로드에 실패했습니다", "error");
      return;
    }
    const json = await res.json();
    let newPosts = Array.isArray(json) ? json : [];

    // play_count 변화 감지 — 이전 저장된 값과 비교
    if (previousPlayCountsRef.current.size > 0) {
      const updated = new Map<string, number | null>();
      newPosts.forEach(post => {
        const prevCount = previousPlayCountsRef.current.get(post.id);
        const newCount = post.latest_stats?.play_count ?? null;
        if (prevCount !== newCount && (prevCount !== null || newCount !== null)) {
          updated.set(post.id, newCount);
        }
      });

      if (updated.size > 0) {
        setUpdatedPlayCounts(updated);

        // 조회수가 있는 게시물에 자동으로 도달수 입력
        for (const [postId, newCount] of updated) {
          if (newCount !== null && newCount > 0) {
            const reach_count = Math.round(newCount * 0.8);
            await fetch(`/api/sponsored-posts/${postId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reach_count }),
            }).catch(() => {});

            // 로컬 상태 업데이트
            newPosts = newPosts.map(p =>
              p.id === postId ? { ...p, reach_count } : p
            );
          }
        }
      }
      previousPlayCountsRef.current.clear();
    }

    setPosts(newPosts);
  }

  async function checkAndResumeMonitoring() {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) return;
      const jobs: { id: string; type: string; status: string }[] = await res.json();
      const inProgress = jobs.find(j => j.type === "monitoring" && j.status === "running");
      if (!inProgress) return;
      runningJobIdRef.current = inProgress.id;
      setRunning(true);
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
      startPollMonitoring(Date.now());
    } catch { /* 무시 */ }
  }

  function startPollMonitoring(startTime: number) {
    pollTimerRef.current = setInterval(async () => {
      if (Date.now() - startTime >= 300_000) {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null; elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        setShowTimeoutError(true);
        return;
      }
      await checkMonitoringJob();
    }, 10_000);
  }

  async function checkMonitoringJob() {
    try {
      const jobRes = await fetch("/api/jobs");
      const jobs: { id: string; status: string; error?: string }[] = await jobRes.json();
      const cur = jobs.find(j => j.id === runningJobIdRef.current);
      if (cur?.status === "done") {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null; elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        await loadPosts();
        toast("모니터링 완료! 데이터가 업데이트됐습니다.", "success");
      } else if (cur?.status === "failed") {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null; elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        toast(`모니터링 실패: ${cur.error ?? "알 수 없는 오류"}`, "error");
      }
    } catch { /* 폴링 오류 무시 */ }
  }

  async function runMonitoring() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setRunning(true);
    setShowTimeoutError(false);
    setElapsedSeconds(0);

    // 수집 전에 현재 play_count들을 저장
    previousPlayCountsRef.current = new Map(
      posts.map(p => [p.id, p.latest_stats?.play_count ?? null])
    );

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "monitoring", payload: {} }),
    });

    if (!res.ok) {
      setRunning(false);
      toast("모니터링 실행에 실패했습니다.", "error");
      return;
    }

    const { job } = await res.json();
    runningJobIdRef.current = job.id;
    toast("모니터링이 시작됐습니다. 완료 시 자동으로 업데이트됩니다.", "info");
    elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    startPollMonitoring(Date.now());
  }

  async function refresh() {
    setLoading(true);
    await loadPosts();
    setLoading(false);
    toast("데이터를 새로고침했습니다.", "success");
  }

  async function addPost() {
    if (!form.url) return;
    setAdding(true);
    const res = await fetch("/api/sponsored-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: form.url,
        product_name: form.product_name || null,
        project_name: form.project_name || null,
        channel_type: form.channel_type || null,
        cost: form.cost !== "" ? Number(form.cost) : null,
      }),
    });
    setAdding(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast(`추가 실패: ${(err as { error?: string }).error ?? "오류가 발생했습니다."}`, "error");
      return;
    }
    setForm({ url: "", product_name: "", project_name: "", channel_type: "", cost: "" });
    setShowAdd(false);
    await loadPosts();
    toast("게시물이 추가됐습니다.", "success");
  }

  function parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (line[i] === ',' && !inQ) {
        result.push(cur.trim()); cur = "";
      } else cur += line[i];
    }
    result.push(cur.trim());
    return result;
  }

  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = (ev.target?.result as string) ?? "";
      const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
      if (lines.length < 2) { toast("데이터가 없습니다. 헤더 포함 2줄 이상 필요합니다.", "error"); return; }
      const rows: CsvRow[] = lines.slice(1).map(line => {
        const cols = parseCsvLine(line);
        return {
          project_name: cols[0] || null,
          product_name: cols[1] || null,
          channel_type: normalizeChannelType(cols[2]),
          url: cols[3] ?? "",
          account_name: cols[4] || null,
          posted_at: cols[5] || null,
          cost: cols[6] !== undefined && cols[6] !== "" ? Number(cols[6]) : null,
          reach_count: cols[7] !== undefined && cols[7] !== "" ? Number(cols[7]) : null,
        };
      }).filter(r => r.url);
      setCsvRows(rows);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  function downloadTemplate() {
    const csv = "프로젝트명,상품명,채널분류,게시물URL,인플루언서명,게시일(YYYY-MM-DD),비용(원),도달수\n예시프로젝트,예시상품,인플루언서,https://www.instagram.com/p/xxxxx/,홍길동,2025-05-01,500000,12000";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "게시물_업로드_템플릿.csv";
    a.click();
  }

  async function uploadCsvRows() {
    if (csvRows.length === 0) return;
    setUploading(true);
    const res = await fetch("/api/sponsored-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(csvRows),
    });
    const resData = await res.json().catch(() => null);
    setUploading(false);
    if (!res.ok) { toast("업로드 실패: " + ((resData as { error?: string })?.error ?? "오류"), "error"); return; }
    const inserted = Array.isArray(resData) ? resData.length : 0;
    const total = csvRows.length;
    setCsvRows([]);
    setShowUpload(false);
    await loadPosts();
    toast(`${inserted}개 게시물이 처리됐습니다. (신규 추가 또는 업데이트)`, "success");
  }

  function handleSort(col: string) {
    setSortDir(prev => sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  }

  const sortedPosts = [...filteredPosts].sort((a, b) => {
    if (!sortCol) return 0;
    const sa = a.latest_stats, sb = b.latest_stats;
    let av: string | number = "", bv: string | number = "";
    switch (sortCol) {
      case "인플루언서": av = (a.account_name ?? a.influencers?.name ?? "").toLowerCase(); bv = (b.account_name ?? b.influencers?.name ?? "").toLowerCase(); break;
      case "프로젝트명": av = (a.project_name ?? "").toLowerCase(); bv = (b.project_name ?? "").toLowerCase(); break;
      case "상품명": av = (a.product_name ?? "").toLowerCase(); bv = (b.product_name ?? "").toLowerCase(); break;
      case "증분량":
        av = (!a.latest_stats || !a.prev_stats) ? -Infinity : (a.latest_stats.play_count ?? 0) - (a.prev_stats.play_count ?? 0);
        bv = (!b.latest_stats || !b.prev_stats) ? -Infinity : (b.latest_stats.play_count ?? 0) - (b.prev_stats.play_count ?? 0);
        break;
      case "채널분류": av = (a.channel_type ?? "").toLowerCase(); bv = (b.channel_type ?? "").toLowerCase(); break;
      case "카테고리": av = (a.influencers?.category ?? "").toLowerCase(); bv = (b.influencers?.category ?? "").toLowerCase(); break;
      case "유형": av = getPostType(a.url); bv = getPostType(b.url); break;
      case "게시일": av = a.posted_at ?? ""; bv = b.posted_at ?? ""; break;
      case "조회수": av = sa?.play_count ?? -1; bv = sb?.play_count ?? -1; break;
      case "도달수": av = a.reach_count ?? -1; bv = b.reach_count ?? -1; break;
      case "비용": av = a.cost ?? -1; bv = b.cost ?? -1; break;
      case "조회당비용":
        av = (a.cost != null && sa?.play_count != null && sa.play_count > 0) ? a.cost / sa.play_count : Infinity;
        bv = (b.cost != null && sb?.play_count != null && sb.play_count > 0) ? b.cost / sb.play_count : Infinity;
        break;
      case "도달당비용":
        av = (a.cost != null && a.reach_count != null && a.reach_count > 0) ? a.cost / a.reach_count : Infinity;
        bv = (b.cost != null && b.reach_count != null && b.reach_count > 0) ? b.cost / b.reach_count : Infinity;
        break;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const sp = (col: string) => ({
    onSort: () => handleSort(col),
    sorted: (sortCol === col ? sortDir : null) as "asc" | "desc" | null,
  });

  function downloadCSV() {
    const headers = ["인플루언서", "프로젝트명", "상품명", "채널분류", "유형", "게시일", "증분량", "조회수", "도달수", "비용(원)", "조회당비용(원)", "도달당비용(원)"];
    const rows = sortedPosts.map(post => {
      const s = post.latest_stats;
      const play = s?.play_count ?? null;
      const reach = post.reach_count ?? null;
      const cost = post.cost ?? null;
      const cpr = cost != null && play != null && play > 0 ? (cost / play).toFixed(2) : "";
      const cpreach = cost != null && reach != null && reach > 0 ? (cost / reach).toFixed(2) : "";
      return [
        post.account_name ?? post.influencers?.name ?? "",
        post.project_name ?? "",
        post.product_name ?? "",
        post.channel_type ?? "",
        getPostType(post.url),
        post.posted_at ?? "",
        (play != null && post.prev_stats?.play_count != null) ? (play - post.prev_stats.play_count) : "",
        play ?? "",
        reach ?? "",
        cost ?? "",
        cpr,
        cpreach,
      ];
    });
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `모니터링_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function deletePost(id: string) {
    if (!confirm("게시물을 삭제하시겠습니까?")) return;
    await fetch(`/api/sponsored-posts/${id}`, { method: "DELETE" });
    setPosts(prev => prev.filter(p => p.id !== id));
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}건을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    await Promise.all([...selected].map(id => fetch(`/api/sponsored-posts/${id}`, { method: "DELETE" })));
    setPosts(prev => prev.filter(p => !selected.has(p.id)));
    setSelected(new Set());
    setDeleting(false);
    toast(`${selected.size}건 삭제됐습니다.`, "success");
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  function toggleSelectAll() {
    const ids = filteredPosts.map(p => p.id);
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(ids));
  }

  async function patchPost(postId: string, field: string, value: string) {
    // Escape 취소 후 onBlur 발화 방지: editCell이 이미 null이면 저장 안 함
    if (!editCell) return;
    const isNumeric = field === "cost" || field === "reach_count";
    const payload = isNumeric
      ? { [field]: value === "" ? null : Number(value) }
      : { [field]: value || null };
    const res = await fetch(`/api/sponsored-posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const stored = isNumeric ? (value === "" ? null : Number(value)) : (value || null);
      const now = new Date().toISOString().slice(0, 10);
      setPosts(prev => prev.map(p => p.id === postId ? {
        ...p,
        [field]: stored,
        latest_stats: updatePostLatestStats(p, now)
      } : p));
    } else {
      toast("저장에 실패했습니다.", "error");
    }
    setEditCell(null);
  }

  async function patchPlayCount(postId: string, value: string) {
    const play_count = value === "" ? null : Number(value);

    try {
      // 1️⃣ 조회수 저장
      const res = await fetch(`/api/sponsored-posts/${postId}/stats`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ play_count }),
      });

      if (!res.ok) {
        toast("조회수 저장에 실패했습니다.", "error");
        setEditPlayCount(null);
        return;
      }

      const now = new Date().toISOString().slice(0, 10);
      let reach_count = null;

      // 2️⃣ 도달수 계산 및 저장
      if (play_count !== null && play_count > 0) {
        reach_count = Math.round(play_count * 0.8);

        // reach_count 저장 (비동기로 계속 진행)
        await fetch(`/api/sponsored-posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reach_count }),
        });
      } else if (play_count === null || play_count === 0) {
        // play_count가 0이면 reach_count도 null로
        await fetch(`/api/sponsored-posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reach_count: null }),
        });
      }

      // 3️⃣ UI 업데이트
      setPosts(prev => prev.map(p => {
        if (p.id === postId) {
          const updated = {
            ...p,
            latest_stats: updatePostLatestStats(p, now, { play_count })
          };
          // reach_count는 계산된 값으로 설정 (null도 명시적으로 설정)
          if (reach_count !== null) {
            updated.reach_count = reach_count;
          }
          return updated;
        }
        return p;
      }));

      console.log(`[도달수 저장] postId=${postId}, reach_count=${reach_count}`);
      toast("저장되었습니다.", "success");
    } catch (err) {
      console.error("[patchPlayCount 오류]", err);
      toast("저장 중 오류가 발생했습니다.", "error");
    } finally {
      setEditPlayCount(null);
    }
  }

  async function patchCategory(postId: string, infId: string, value: string) {
    const res = await fetch(`/api/influencers/${infId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: value || null }),
    });
    if (res.ok) {
      const now = new Date().toISOString().slice(0, 10);
      setPosts(prev => prev.map(p => p.id === postId
        ? {
          ...p,
          influencers: p.influencers ? { ...p.influencers, category: value || null } : null,
          latest_stats: updatePostLatestStats(p, now)
        }
        : p));
    } else {
      toast("저장에 실패했습니다.", "error");
    }
    setEditCategory(null);
  }

  function startResize(col: string, e: React.MouseEvent, isSticky = false) {
    e.preventDefault();
    e.stopPropagation();
    const startW = isSticky ? stickyColWidths[col] : colWidths[col];
    resizingRef.current = { col, startX: e.clientX, startW, isSticky };
    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return;
      const newW = Math.max(40, resizingRef.current.startW + ev.clientX - resizingRef.current.startX);
      if (resizingRef.current.isSticky) {
        setStickyColWidths(prev => ({ ...prev, [resizingRef.current!.col]: newW }));
      } else {
        setColWidths(prev => ({ ...prev, [resizingRef.current!.col]: newW }));
      }
    }
    function onUp() {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div className="min-h-screen">
      {/* 날짜 채널타입 분류 툴팁 */}
      {dateTooltip && (() => {
        const breakdown = typeBreakdownByDate.get(dateTooltip.date);
        const entries = breakdown
          ? (['바이럴','협찬','기타'] as const).flatMap(t =>
              breakdown[t] !== undefined && breakdown[t] !== 0 ? [[t, breakdown[t]] as const] : []
            )
          : [];
        return (
          <div
            className="pointer-events-none fixed z-[9999] bg-white border border-a-hairline rounded-lg shadow-lg px-3 py-2 text-[12px]"
            style={{ right: `calc(100vw - ${dateTooltip.x}px + 8px)`, top: dateTooltip.y, transform: 'translateY(-50%)' }}
          >
            {entries.length > 0 ? entries.map(([type, val]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-a-ink-muted">{type}:</span>
                <span className={val > 0 ? "text-a-blue font-semibold" : val < 0 ? "text-rose-500 font-semibold" : "text-gray-400"}>
                  {val > 0 ? '+' : ''}{val.toLocaleString()}회
                </span>
              </div>
            )) : (
              <span className="text-a-ink-muted">조회수 데이터 없음</span>
            )}
          </div>
        );
      })()}
      <header className="bg-white border-b border-gray-100 h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-a-ink transition text-sm">←</Link>
          <span className="text-a-ink text-sm font-semibold tracking-tight">협찬 모니터링</span>
          <span className="text-gray-400 text-xs">
            {hasFilter ? `${filteredPosts.length} / ${posts.length}건` : `${posts.length}건`}
          </span>
        </div>
      </header>

      <div className="sticky top-14 z-[35] bg-white border-b border-a-hairline px-6 h-11 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 text-xs text-a-ink-muted hover:text-a-ink transition">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10 9.5v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="10" cy="6.5" r="1" fill="currentColor"/>
            </svg>
            사용 안내
          </button>
          {lastMonitoredAt && (
            <span className="text-xs text-a-ink-muted whitespace-nowrap">
              마지막 업데이트 <span className="font-medium text-a-ink">{formatTimestamp(lastMonitoredAt)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {selected.size > 0 && (
            <button onClick={deleteSelected} disabled={deleting}
              className="text-xs px-3 py-1.5 rounded-full border border-red-300 text-red-500 hover:bg-red-50 disabled:opacity-40 transition">
              선택 삭제 ({selected.size})
            </button>
          )}
          <button onClick={() => setShowUpload(true)} className="btn-secondary">CSV 업로드</button>
          <button onClick={() => setShowAdd(true)} className="btn-secondary">+ 게시물 추가</button>
          <button onClick={downloadCSV} disabled={filteredPosts.length === 0} className="btn-secondary">엑셀 다운로드</button>
          <button onClick={refresh} disabled={loading} className="btn-secondary">새로고침</button>
          {running && (
            <>
              <span className="text-xs text-a-ink-muted tabular-nums">
                {elapsedSeconds < 60 ? `${elapsedSeconds}초` : `${Math.floor(elapsedSeconds / 60)}분 ${elapsedSeconds % 60}초`}
              </span>
              <button onClick={checkMonitoringJob} className="btn-secondary">지금 확인</button>
            </>
          )}
          <button onClick={runMonitoring} disabled={running} className="btn-primary">
            {running ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                실행 중
              </span>
            ) : "지금 수집"}
          </button>
        </div>
      </div>

      <div className="p-6">

        {/* 필터 바 */}
        <div className="bg-white rounded-[14px] border border-a-hairline px-4 py-2.5 mb-4 flex items-center gap-2.5 flex-wrap">
          <input
            type="text"
            placeholder="인플루언서 검색"
            value={filters.name}
            onChange={e => setFilters(p => ({ ...p, name: e.target.value }))}
            className={`filter-input w-32 ${filters.name ? "border-a-blue" : ""}`}
          />
          <input
            type="text"
            placeholder="프로젝트명"
            value={filters.project}
            onChange={e => setFilters(p => ({ ...p, project: e.target.value }))}
            className={`filter-input w-28 ${filters.project ? "border-a-blue" : ""}`}
          />
          {productOptions.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap scrollbar-none pb-0.5">
              {productOptions.map(p => {
                const active = filters.products.includes(p);
                return (
                  <button key={p}
                    onClick={() => setFilters(prev => ({
                      ...prev,
                      products: active ? prev.products.filter(x => x !== p) : [...prev.products, p],
                    }))}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      active ? "border-a-blue bg-blue-50 text-a-blue font-medium" : "border-a-hairline text-a-ink-muted hover:border-gray-400"
                    }`}
                  >{p}</button>
                );
              })}
            </div>
          )}
          <select
            value={filters.type}
            onChange={e => setFilters(p => ({ ...p, type: e.target.value }))}
            className={`filter-select ${filters.type !== "all" ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
          >
            <option value="all">전체 유형</option>
            {POST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div className="relative">
            <button
              onClick={() => setShowChannelTypeDropdown(!showChannelTypeDropdown)}
              className={`filter-select ${filters.channelTypes.length > 0 ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
            >
              {filters.channelTypes.length === 0
                ? "전체 채널분류"
                : filters.channelTypes.length === 1
                ? filters.channelTypes[0]
                : `${filters.channelTypes[0]} 외 ${filters.channelTypes.length - 1}`
              }
            </button>
            {showChannelTypeDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-a-hairline rounded-[8px] shadow-lg z-50 w-48">
                <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                  <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                    <input
                      type="checkbox"
                      checked={filters.channelTypes.length === 0}
                      onChange={() => {
                        setFilters(p => ({ ...p, channelTypes: [] }));
                      }}
                      className="w-3.5 h-3.5 accent-a-blue cursor-pointer"
                    />
                    전체
                  </label>
                  {CHANNEL_TYPES.map(t => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                      <input
                        type="checkbox"
                        checked={filters.channelTypes.includes(t)}
                        onChange={e => {
                          if (e.target.checked) {
                            setFilters(p => ({ ...p, channelTypes: [...p.channelTypes, t] }));
                          } else {
                            setFilters(p => ({ ...p, channelTypes: p.channelTypes.filter(x => x !== t) }));
                          }
                        }}
                        className="w-3.5 h-3.5 accent-a-blue cursor-pointer"
                      />
                      {t}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="w-px h-4 bg-a-hairline mx-0.5" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-a-ink-muted whitespace-nowrap">게시일</span>
            <input type="date" value={filters.postedFrom}
              max={filters.postedTo || undefined}
              onChange={e => {
                const v = e.target.value;
                setFilters(p => ({ ...p, postedFrom: v, postedTo: p.postedTo && v > p.postedTo ? v : p.postedTo }));
              }}
              className={`filter-input ${filters.postedFrom ? "border-a-blue" : ""}`} />
            <span className="text-xs text-a-ink-muted">–</span>
            <input type="date" value={filters.postedTo}
              min={filters.postedFrom || undefined}
              onChange={e => {
                const v = e.target.value;
                setFilters(p => ({ ...p, postedTo: v, postedFrom: p.postedFrom && v < p.postedFrom ? v : p.postedFrom }));
              }}
              className={`filter-input ${filters.postedTo ? "border-a-blue" : ""}`} />
          </div>
          <div className="w-px h-4 bg-a-hairline mx-0.5" />
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-a-ink-muted whitespace-nowrap">조회수 기간</span>
            <input type="date" value={filters.dateFrom}
              max={filters.dateTo || undefined}
              onChange={e => {
                const v = e.target.value;
                setFilters(p => ({ ...p, dateFrom: v, dateTo: p.dateTo && v > p.dateTo ? v : p.dateTo }));
              }}
              className={`filter-input ${filters.dateFrom ? "border-a-blue" : ""}`} />
            <span className="text-xs text-a-ink-muted">–</span>
            <input type="date" value={filters.dateTo}
              min={filters.dateFrom || undefined}
              onChange={e => {
                const v = e.target.value;
                setFilters(p => ({ ...p, dateTo: v, dateFrom: p.dateFrom && v < p.dateFrom ? v : p.dateFrom }));
              }}
              className={`filter-input ${filters.dateTo ? "border-a-blue" : ""}`} />
            {/* 빠른 선택 버튼 — 날짜 인풋 바로 우측 */}
            {(() => {
              const fmt = (d: Date) => d.toISOString().slice(0, 10);
              const today = new Date();
              const todayStr = fmt(today);
              // 일요일(getDay=0)을 7로 처리해 월요일 시작 기준 올바르게 계산
              const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
              const presets = [
                { label: "전체",   from: "",          to: "" },
                { label: "오늘",   from: todayStr,    to: todayStr },
                { label: "어제",   from: fmt(new Date(today.getTime() - 86400000)), to: fmt(new Date(today.getTime() - 86400000)) },
                { label: "이번주", from: fmt(new Date(today.getTime() - (dayOfWeek - 1) * 86400000)), to: todayStr },
                { label: "지난주", from: fmt(new Date(today.getTime() - (dayOfWeek + 6) * 86400000)), to: fmt(new Date(today.getTime() - dayOfWeek * 86400000)) },
                { label: "이번달", from: `${todayStr.slice(0, 7)}-01`, to: todayStr },
              ];
              return presets.map(p => {
                const active = filters.dateFrom === p.from && filters.dateTo === p.to;
                return (
                  <button key={p.label}
                    onClick={() => setFilters(prev => ({ ...prev, dateFrom: p.from, dateTo: p.to }))}
                    className={`text-[11px] px-2.5 py-0.5 rounded-full border transition-all whitespace-nowrap ${active ? "border-a-blue bg-a-blue text-white font-medium" : "border-a-hairline text-a-ink-muted hover:border-a-blue hover:text-a-blue"}`}>
                    {p.label}
                  </button>
                );
              });
            })()}
          </div>
          <div className="flex-1" />
          {hasFilter && (
            <button onClick={() => setFilters(INIT_FILTERS)} className="btn-ghost py-1">
              초기화
            </button>
          )}
        </div>

        {filteredPosts.length > 0 && (
          <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(100,120,180,0.08)] mb-4 overflow-hidden">
            {/* 요약 수치 */}
            <div className="flex items-stretch border-b border-a-hairline">
              {(() => {
                // 누적 데이터: 검색량 총합, B2B 매출
                const searchTotalSum = chartData.length > 0 ? chartData[chartData.length - 1].value : 0;
                const b2bTotal = 0; // B2B 데이터는 추후 연결 예정
                return [
                  { label: "조회수 합계", value: totalPlayCount, color: "text-a-ink" },
                  { label: "검색량 총합", value: searchTotalSum, color: "text-gray-600" },
                  { label: "B2B 매출", value: b2bTotal, color: "text-green-600" },
                ];
              })().map((item, i) => (
                <div key={i} className={`flex-1 px-6 py-5 ${i > 0 ? "border-l border-a-hairline" : ""}`}>
                  <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest mb-1.5">{item.label}</p>
                  <p className={`text-[28px] font-bold tabular-nums tracking-tight leading-none ${item.color}`}>{item.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            {/* 차트 + 테이블 */}
            <div className="flex divide-x divide-a-hairline">
              {/* 차트 */}
              <div className="flex-[4] px-6 py-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest">조회수 트렌드 (누적)</p>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-0.5 bg-a-blue" />
                      <span className="text-xs text-a-ink-muted">조회수</span>
                    </div>
                    {lsSearchData && lsSearchData.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <svg width="10" height="3" viewBox="0 0 20 4"><line x1="0" y1="2" x2="20" y2="2" stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="3 2" /></svg>
                        <span className="text-xs text-a-ink-muted">검색량</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-0.5 bg-gray-400" />
                      <span className="text-xs text-a-ink-muted">전체 전환 광고비</span>
                    </div>
                  </div>
                </div>
                <LineChart
                  data={chartData}
                  height={160}
                  gradId="summaryGrad"
                  lsData={lsSearchData}
                  secondaryData={mainAdCosts.length > 0 ? mainAdCosts.map(d => ({date: d.date, value: d.total_cost})) : undefined}
                  secondaryColor="#b3b3b3"
                  postsOnDate={(date) =>
                    filteredPosts
                      .filter(p => p.posted_at?.slice(0, 10) === date)
                      .map(p => ({ name: p.account_name ?? p.influencers?.name ?? '-', url: p.url }))
                  }
                />
              </div>
              {/* 증감 테이블 */}
              <div className="flex-[3] flex flex-col self-start min-w-[220px]">
                <div className="px-5 py-4 border-b border-a-hairline">
                  <p className="text-[11px] font-medium text-a-ink-muted">일자별 증감</p>
                </div>
                {deltaTableData.some(d => d.play < 0) && (
                  <div className="mx-3 mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-[8px] text-[11px] text-amber-700 flex items-start gap-1.5">
                    <span>⚠️</span>
                    <span>
                      누적 조회수가 감소한 날짜가 있습니다 ({deltaTableData.filter(d => d.play < 0).map(d => d.date.slice(5).replace("-", "/")).join(", ")}) — 데이터 오류를 확인하세요.
                    </span>
                  </div>
                )}
                {deltaTableData.length === 0 ? (
                  <div className="flex items-center justify-center flex-1 text-sm text-a-ink-muted py-10">측정 데이터 2일 이상 필요</div>
                ) : (
                  (() => {
                    const KR_HOLIDAYS = new Set([
                      '2025-01-01','2025-01-28','2025-01-29','2025-01-30',
                      '2025-03-01','2025-05-05','2025-05-06','2025-06-06',
                      '2025-08-15','2025-09-06','2025-09-07','2025-09-08',
                      '2025-10-03','2025-10-09','2025-12-25',
                      '2026-01-01','2026-02-17','2026-02-18','2026-02-19',
                      '2026-03-01','2026-05-05','2026-06-06','2026-08-17',
                    ]);
                    const DAY_KO = ['일','월','화','수','목','금','토'];
                    function dateColor(dateStr: string) {
                      const d = new Date(dateStr);
                      const dow = d.getDay();
                      if (KR_HOLIDAYS.has(dateStr) || dow === 0) return 'text-[#8B1A2E]'; // 버건디
                      if (dow === 6) return 'text-[#1a3c82]'; // 남색
                      return 'text-a-ink';
                    }
                    const rows = [{ date: dailyTotals[0].date, play: 0, likes: 0, comments: 0 }, ...deltaTableData];
                    const reversed = [...rows].reverse();
                    return (
                      <div className="overflow-y-auto" style={{ maxHeight: 264 }}>
                        <table className="w-full">
                          <thead className="sticky top-0 z-10 bg-white border-b border-a-hairline">
                            <tr>
                              <th className="px-5 py-2.5 text-left text-[11px] font-semibold text-a-ink-muted">날짜</th>
                              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-a-ink-muted">조회수</th>
                              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-a-ink-muted">검색량</th>
                              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-a-ink-muted">댓글</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reversed.map((d, i) => {
                              const dow = new Date(d.date).getDay();
                              const dayLabel = DAY_KO[dow];
                              const cls = dateColor(d.date);
                              function deltaCell(v: number | null | undefined, accent = "text-a-blue") {
                                if (v == null) return <td className="px-4 py-3 text-right text-gray-300">-</td>;
                                const pos = v > 0, neg = v < 0;
                                return (
                                  <td className={`px-4 py-3 text-right tabular-nums text-sm font-semibold ${pos ? accent : neg ? "text-emerald-600" : "text-gray-200"}`}>
                                    {pos ? "+" : ""}{v.toLocaleString()}
                                  </td>
                                );
                              }
                              return (
                                <tr key={i} className="border-b border-a-divider last:border-0 hover:bg-a-parchment/50 transition-colors">
                                  <td
                                    className={`px-5 py-3 text-sm font-bold tabular-nums whitespace-nowrap ${cls}`}
                                    onMouseEnter={(e) => {
                                      const r = e.currentTarget.getBoundingClientRect();
                                      setDateTooltip({ date: d.date, x: r.left, y: r.top + r.height / 2 });
                                    }}
                                    onMouseLeave={() => setDateTooltip(null)}
                                  >
                                    {d.date.slice(0,4) !== String(new Date().getFullYear()) && (
                                      <span className="text-[10px] font-normal text-gray-400 mr-0.5">'{d.date.slice(2,4)}.</span>
                                    )}
                                    {d.date.slice(5).replace("-", "/")}
                                    <span className={`ml-1.5 text-[11px] font-medium ${cls}`}>({dayLabel})</span>
                                  </td>
                                  {deltaCell(d.play, "text-a-blue")}
                                  {deltaCell(d.search, "text-gray-500")}
                                  {deltaCell(d.comments, "text-purple-500")}
                                </tr>
                              );
                            })}
                            {/* 여백 행 */}
                            <tr><td colSpan={4} className="py-2" /></tr>
                            <tr><td colSpan={4} className="py-2" /></tr>
                            <tr><td colSpan={4} className="py-2" /></tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
          </div>
        )}

        {brandMetrics.length > 0 && (() => {
          const fmtK = (v: number) => v >= 10000 ? `${(v/10000).toFixed(1).replace(/\.0$/,"")}만` : v >= 1000 ? `${(v/1000).toFixed(1).replace(/\.0$/,"")}천` : v.toLocaleString();
          type BmSeries = { key: "yt_views"|"yt_unique_viewers"|"ig_profile_views"|"ig_reach"; label: string; color: string };
          const SERIES: BmSeries[] = [
            { key: "yt_views",          label: "유튜브 조회수",         color: "#FF0000" },
            { key: "yt_unique_viewers", label: "유튜브 순시청자",        color: "#ff6b6b" },
            { key: "ig_profile_views",  label: "인스타 프로필 방문자",   color: "#C13584" },
            { key: "ig_reach",          label: "인스타 도달",            color: "#833AB4" },
          ];
          const dates = brandMetrics.map(d => d.measured_at);
          const VW = 900, H = 160, PAD = { t: 12, b: 28, l: 52, r: 8 };
          const iW = VW - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
          const xi = (i: number) => PAD.l + (dates.length > 1 ? (i / (dates.length - 1)) * iW : iW / 2);
          const step = Math.max(1, Math.ceil(dates.length / 6));
          const xLabels = dates.map((_, i) => i).filter(i => i % step === 0 || i === dates.length - 1);
          return (
            <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(100,120,180,0.08)] mb-4 overflow-hidden">
              <div className="px-6 pt-5 pb-1 flex items-center gap-3 flex-wrap">
                <p className="text-[11px] font-semibold text-a-ink-muted uppercase tracking-widest">플랫폼 지표</p>
                <div className="flex items-center gap-4 flex-wrap">
                  {SERIES.map(s => {
                    const vals = brandMetrics.map(d => d[s.key]).filter((v): v is number => v !== null);
                    const latest = vals[vals.length - 1];
                    return (
                      <div key={s.key} className="flex items-center gap-1.5">
                        <div className="w-3 h-3 rounded-full" style={{ background: s.color }} />
                        <span className="text-[11px] text-a-ink-muted">{s.label}</span>
                        {latest != null && <span className="text-[11px] font-semibold text-a-ink">{fmtK(latest)}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="px-4 pb-4">
                <svg viewBox={`0 0 ${VW} ${H}`} className="w-full" style={{ display: "block" }}>
                  {[0, 0.5, 1].map((t, i) => (
                    <line key={i} x1={PAD.l} x2={VW - PAD.r} y1={PAD.t + iH * (1 - t)} y2={PAD.t + iH * (1 - t)} stroke="#f3f4f6" strokeWidth="1" />
                  ))}
                  {SERIES.map(s => {
                    const vals = brandMetrics.map(d => d[s.key]);
                    const nums = vals.filter((v): v is number => v !== null);
                    if (nums.length < 2) return null;
                    const max = Math.max(...nums) || 1;
                    const points = brandMetrics.map((d, i) => {
                      const v = d[s.key];
                      if (v === null) return null;
                      return [xi(i), PAD.t + iH - (v / max) * iH] as [number, number];
                    });
                    const path = points
                      .map((p, i) => p ? `${i === 0 || !points.slice(0, i).some(Boolean) ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}` : null)
                      .filter(Boolean).join(" ");
                    return <path key={s.key} d={path} fill="none" stroke={s.color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.85" />;
                  })}
                  {xLabels.map(i => (
                    <text key={i} x={xi(i)} y={H - 8} textAnchor="middle" fontSize="8.5" fill="#9ca3af">
                      {dates[i].slice(5).replace("-", "/")}
                    </text>
                  ))}
                </svg>
              </div>
            </div>
          );
        })()}

        {/* Instagram 유입수 차트 */}
        {(() => {
          const data = brandMetrics.map(d => ({
            measured_at: d.measured_at,
            ig_profile_views: d.ig_profile_views ?? 0,
          })).filter(d => d.ig_profile_views > 0);
          if (data.length < 2) return null;

          const max = Math.max(...data.map(d => d.ig_profile_views)) || 1;
          const VW = 900, H = 160, PAD = { t: 12, b: 28, l: 52, r: 8 };
          const iW = VW - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
          const xi = (i: number) => PAD.l + (data.length > 1 ? (i / (data.length - 1)) * iW : iW / 2);
          const yi = (v: number) => PAD.t + iH - (v / max) * iH;
          const step = Math.max(1, Math.ceil(data.length / 6));
          const xLabels = data.map((_, i) => i).filter(i => i % step === 0 || i === data.length - 1);

          const points = data.map((d, i) => [xi(i), yi(d.ig_profile_views)] as [number, number]);
          const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
          const areaPath = `${path} L ${points[points.length - 1][0]},${H - PAD.b} L ${PAD.l},${H - PAD.b} Z`;

          return (
            <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(100,120,180,0.08)] mb-4 overflow-hidden">
              <div className="px-6 pt-5 pb-1 flex items-center gap-3 flex-wrap">
                <p className="text-[11px] font-semibold text-a-ink-muted uppercase tracking-widest">라라스윗 인스타그램 유입수</p>
              </div>
              <div className="px-4 pb-4">
                <svg viewBox={`0 0 ${VW} ${H}`} className="w-full" style={{ display: "block" }}>
                  {[0, 0.5, 1].map((t, i) => (
                    <line key={i} x1={PAD.l} x2={VW - PAD.r} y1={PAD.t + iH * (1 - t)} y2={PAD.t + iH * (1 - t)} stroke="#f3f4f6" strokeWidth="1" />
                  ))}
                  <defs>
                    <linearGradient id="igGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#C13584" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#C13584" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={areaPath} fill="url(#igGrad)" />
                  <path d={path} fill="none" stroke="#C13584" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                  {xLabels.map(i => (
                    <text key={i} x={xi(i)} y={H - 8} textAnchor="middle" fontSize="8.5" fill="#9ca3af">
                      {data[i].measured_at.slice(5).replace("-", "/")}
                    </text>
                  ))}
                </svg>
              </div>
            </div>
          );
        })()}

        {/* YouTube 검색량 차트 */}
        {(() => {
          const data = brandMetrics.map(d => ({
            measured_at: d.measured_at,
            yt_search_views: d.yt_search_views ?? 0,
          })).filter(d => d.yt_search_views > 0);
          if (data.length < 2) return null;

          const max = Math.max(...data.map(d => d.yt_search_views)) || 1;
          const VW = 900, H = 160, PAD = { t: 12, b: 28, l: 52, r: 8 };
          const iW = VW - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
          const xi = (i: number) => PAD.l + (data.length > 1 ? (i / (data.length - 1)) * iW : iW / 2);
          const yi = (v: number) => PAD.t + iH - (v / max) * iH;
          const step = Math.max(1, Math.ceil(data.length / 6));
          const xLabels = data.map((_, i) => i).filter(i => i % step === 0 || i === data.length - 1);

          const points = data.map((d, i) => [xi(i), yi(d.yt_search_views)] as [number, number]);
          const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
          const areaPath = `${path} L ${points[points.length - 1][0]},${H - PAD.b} L ${PAD.l},${H - PAD.b} Z`;

          return (
            <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(100,120,180,0.08)] mb-4 overflow-hidden">
              <div className="px-6 pt-5 pb-1 flex items-center gap-3 flex-wrap">
                <p className="text-[11px] font-semibold text-a-ink-muted uppercase tracking-widest">유튜브 검색 유입수</p>
              </div>
              <div className="px-4 pb-4">
                <svg viewBox={`0 0 ${VW} ${H}`} className="w-full" style={{ display: "block" }}>
                  {[0, 0.5, 1].map((t, i) => (
                    <line key={i} x1={PAD.l} x2={VW - PAD.r} y1={PAD.t + iH * (1 - t)} y2={PAD.t + iH * (1 - t)} stroke="#f3f4f6" strokeWidth="1" />
                  ))}
                  <defs>
                    <linearGradient id="ytSearchGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF0000" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#FF0000" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={areaPath} fill="url(#ytSearchGrad)" />
                  <path d={path} fill="none" stroke="#FF0000" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                  {xLabels.map(i => (
                    <text key={i} x={xi(i)} y={H - 8} textAnchor="middle" fontSize="8.5" fill="#9ca3af">
                      {data[i].measured_at.slice(5).replace("-", "/")}
                    </text>
                  ))}
                </svg>
              </div>
            </div>
          );
        })()}

        <div className="bg-white rounded-[18px] border border-a-hairline overflow-hidden">
          <div className="overflow-x-auto" style={{ transform: "rotateX(180deg)" }}>
          <div style={{ transform: "rotateX(180deg)" }}>
          {loading ? (
            <div className="p-8 text-center text-a-ink-muted text-sm">로딩 중...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-30">
                <tr className="border-b border-a-hairline">
                  <th className="pl-3 pr-1 py-3 sticky z-40 bg-white" style={{ left: 0, width: 36, minWidth: 36 }}>
                    <input type="checkbox" className="w-3.5 h-3.5 accent-a-blue cursor-pointer"
                      checked={filteredPosts.length > 0 && filteredPosts.every(p => selected.has(p.id))}
                      onChange={toggleSelectAll} />
                  </th>
                  <TH col="증분량" w={stickyColWidths["증분량"]} leftPos={stickyLefts["증분량"]} onResize={e => startResize("증분량", e, true)} right {...sp("증분량")}>증분량</TH>
                  <TH w={colWidths["채널분류"]} onResize={e => startResize("채널분류", e)} {...sp("채널분류")}>
                    <span className="relative group/ct cursor-default">
                      채널 분류
                      <span className="hidden group-hover/ct:block absolute top-full left-0 mt-1 z-50 bg-gray-900 text-white text-[11px] rounded-[8px] px-3 py-2 whitespace-nowrap shadow-lg font-normal normal-case tracking-normal">
                        {CHANNEL_TYPES.map((t, i) => <span key={i} className="block">{t}</span>)}
                      </span>
                    </span>
                  </TH>
                  <TH w={colWidths["게시일"]} onResize={e => startResize("게시일", e)} {...sp("게시일")}>게시일</TH>
                  <TH w={colWidths["인플루언서"]} onResize={e => startResize("인플루언서", e)} {...sp("인플루언서")}>인플루언서</TH>
                  <TH w={colWidths["상품명"]} onResize={e => startResize("상품명", e)} {...sp("상품명")}>상품명</TH>
                  <TH w={colWidths["프로젝트명"]} onResize={e => startResize("프로젝트명", e)} {...sp("프로젝트명")}>프로젝트명</TH>
                  <TH right w={colWidths["비용"]} onResize={e => startResize("비용", e)} {...sp("비용")}>비용</TH>
                  <TH right w={colWidths["조회수"]} onResize={e => startResize("조회수", e)} {...sp("조회수")}>조회수</TH>
                  <TH right w={colWidths["조회당비용"]} onResize={e => startResize("조회당비용", e)} {...sp("조회당비용")}>
                    <span className="group/cpr relative">
                      조회당비용
                      <div className="hidden group-hover/cpr:block absolute top-full right-0 mt-1.5 z-[9999] bg-white border border-a-hairline rounded-[10px] px-3.5 py-3 shadow-lg min-w-[200px] pointer-events-none text-left font-normal normal-case tracking-normal">
                        <p className="text-[11px] font-semibold text-a-ink mb-2">조회당비용 (비용 ÷ 평균 조회수)</p>
                        <div className="space-y-1 text-[11px]">
                          <p><span className="font-semibold text-emerald-600">BEST</span> <span className="text-a-ink-muted">20원 미만</span></p>
                          <p><span className="font-semibold text-blue-500">GOOD</span> <span className="text-a-ink-muted">20~24원</span></p>
                          <p><span className="font-semibold text-amber-500">SOSO</span> <span className="text-a-ink-muted">25~29원</span></p>
                          <p><span className="text-gray-400">BAD 30원 이상</span></p>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-2">📌 도달 비용 효율 검토의 핵심 지표</p>
                      </div>
                    </span>
                  </TH>
                  <TH right w={colWidths["도달수"]} onResize={e => startResize("도달수", e)} {...sp("도달수")}>도달수</TH>
                  <TH right w={colWidths["도달당비용"]} onResize={e => startResize("도달당비용", e)} {...sp("도달당비용")}>도달당비용</TH>
                  <TH w={10}>캡션</TH>
                  <TH right w={colWidths["좋아요"]} onResize={e => startResize("좋아요", e)} {...sp("좋아요")}>좋아요</TH>
                  <TH right w={colWidths["댓글"]} onResize={e => startResize("댓글", e)} {...sp("댓글")}>댓글</TH>
                  <TH className="text-center" w={colWidths["트렌드"]} onResize={e => startResize("트렌드", e)}>트렌드</TH>
                  <TH w={colWidths["특이사항"]} onResize={e => startResize("특이사항", e)}>특이사항</TH>
                  <TH w={colWidths["삭제"]}></TH>
                </tr>
              </thead>
              <tbody>
                {sortedPosts.map(post => {
                  // ⚠️ 재발방지: getFilteredStats() 사용해서 필터 범위 일관성 보장
                  // 날짜 필터 시 해당 기간의 측정값들을 추출
                  const filteredStats = (filters.dateFrom || filters.dateTo)
                    ? getFilteredStats(post.all_stats ?? [], filters.dateFrom, filters.dateTo)
                    : (post.all_stats ?? []);

                  // 현재값: 필터 범위 내 마지막 측정값, 없으면 latest_stats
                  const s = filteredStats.length > 0 ? filteredStats[filteredStats.length - 1] : post.latest_stats;

                  // 이전값: 필터 범위 내 그 이전 값, 없으면 필터 범위 밖의 이전값
                  // ⚠️ 중요: 필터 적용 시 필터 범위 내에서 prev를 재계산 (전체 데이터의 prev_stats 사용 금지)
                  const prev = (filters.dateFrom || filters.dateTo)
                    ? filteredStats.length > 1
                      ? filteredStats[filteredStats.length - 2]  // 필터 범위 내 이전값
                      : null  // 필터 범위 내 데이터가 1개면 비교 불가
                    : post.prev_stats;  // 필터 미적용: 전체 데이터의 이전값 사용

                  const displayName = post.account_name ?? post.influencers?.name ?? "-";
                  const hl = hasNotableChange(post);
                  return (
                    <tr key={post.id} className={`group border-b border-a-divider last:border-0 transition-colors ${selected.has(post.id) ? "bg-blue-50/40" : hl ? "bg-yellow-50/60 hover:bg-yellow-100/50" : "hover:bg-a-parchment/60"}`}>
                      <td className="pl-3 pr-1 py-3 sticky z-10 bg-inherit" style={{ left: 0, width: 36, minWidth: 36 }}>
                        <input type="checkbox" className="w-3.5 h-3.5 accent-a-blue cursor-pointer"
                          checked={selected.has(post.id)} onChange={() => toggleSelect(post.id)} />
                      </td>
                      <TD col="증분량" w={stickyColWidths["증분량"]} leftPos={stickyLefts["증분량"]} right highlighted={hl}>
                        {(() => {
                          if (s?.play_count == null || prev == null) return <span className="text-gray-300">-</span>;
                          const delta = s.play_count - (prev.play_count ?? 0);
                          return (
                            <span className={`font-semibold ${delta > 0 ? "text-red-500" : delta < 0 ? "text-emerald-600" : "text-gray-300"}`}>
                              {delta > 0 ? "+" : ""}{delta.toLocaleString()}
                            </span>
                          );
                        })()}
                      </TD>
                      <TD muted w={colWidths["채널분류"]}>
                        {editCell?.postId === post.id && editCell?.field === "channel_type" ? (
                          <select autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "channel_type", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "channel_type", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="text-xs bg-transparent border-b border-a-blue outline-none py-0.5 w-full">
                            <option value="">-</option>
                            {CHANNEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "channel_type", value: post.channel_type ?? "" })}
                            className="cursor-text hover:text-a-blue transition-colors">
                            {post.channel_type ?? "-"}
                          </span>
                        )}
                      </TD>
                      <TD muted w={colWidths["게시일"]}>
                        {editCell?.postId === post.id && editCell?.field === "posted_at" ? (
                          <input autoFocus type="date" value={editCell.value}
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
                      <TD w={colWidths["인플루언서"]}>
                        {editCell?.postId === post.id && editCell?.field === "account_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "account_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "account_name", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <div className="flex items-center gap-1 min-w-0 overflow-hidden group/influencer">
                            <span className="font-medium text-left truncate min-w-0">{displayName}</span>
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
                      <TD muted w={colWidths["상품명"]}>
                        {editCell?.postId === post.id && editCell?.field === "product_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "product_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "product_name", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "product_name", value: post.product_name ?? "" })}
                            className="cursor-text hover:text-a-blue transition-colors">
                            {post.product_name ?? "-"}
                          </span>
                        )}
                      </TD>
                      <TD muted w={colWidths["프로젝트명"]}>
                        {editCell?.postId === post.id && editCell?.field === "project_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "project_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "project_name", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "project_name", value: post.project_name ?? "" })}
                            className="cursor-text text-a-ink-muted hover:text-a-blue transition-colors">
                            {post.project_name ?? "-"}
                          </span>
                        )}
                      </TD>
                      <td style={{ minWidth: colWidths["비용"] }}
                        className="px-3 py-4 text-xs tabular-nums text-right whitespace-nowrap cursor-text"
                        onClick={() => editCell?.postId !== post.id && setEditCell({ postId: post.id, field: "cost", value: String(post.cost ?? "") })}>
                        {editCell?.postId === post.id && editCell?.field === "cost" ? (
                          <input autoFocus type="number" value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "cost", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "cost", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          <span className="text-a-ink-muted hover:text-a-blue transition-colors">
                            {post.cost != null ? post.cost.toLocaleString() + "원" : <span className="text-gray-300">-</span>}
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths["조회수"] }}
                        className="px-3 py-4 text-xs tabular-nums text-right whitespace-nowrap">
                        {editPlayCount?.postId === post.id ? (
                          <input autoFocus type="number" value={editPlayCount.value}
                            onChange={e => setEditPlayCount(v => v ? { ...v, value: e.target.value } : null)}
                            onBlur={() => patchPlayCount(post.id, editPlayCount.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPlayCount(post.id, editPlayCount.value); if (e.key === "Escape") setEditPlayCount(null); }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          <div className="flex items-center justify-end gap-1.5 relative">
                            <span onClick={() => setEditPlayCount({ postId: post.id, value: String(s?.play_count ?? "") })}
                              className="text-a-ink-muted hover:text-a-blue transition-colors cursor-text">
                              {fmt(s?.play_count)}
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
                              <div className="absolute bottom-full right-0 mb-2 bg-white border border-a-hairline rounded-[6px] px-2 py-1 text-xs whitespace-nowrap shadow-[0_4px_12px_rgba(0,0,0,0.10)] z-10">
                                <p className="text-a-ink-muted">새로 수집한 값</p>
                                <p className="font-semibold text-red-500">{fmt(updatedPlayCounts.get(post.id))}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <TD right muted w={colWidths["조회당비용"]}>
                        {post.cost != null && s?.play_count != null && s.play_count > 0
                          ? (post.cost / s.play_count).toFixed(2) + "원"
                          : <span className="text-gray-300">-</span>}
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
                          <span className="text-a-ink-muted hover:text-a-blue transition-colors">
                            {post.reach_count != null ? post.reach_count.toLocaleString() : <span className="text-gray-300">-</span>}
                          </span>
                        )}
                      </td>
                      <TD right muted w={colWidths["도달당비용"]}>
                        {post.cost != null && post.reach_count != null && post.reach_count > 0
                          ? (post.cost / post.reach_count).toFixed(2) + "원"
                          : <span className="text-gray-300">-</span>}
                      </TD>
                      <TD muted w={10}>
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
                            {post.content_summary || <span className="text-gray-300">-</span>}
                          </span>
                        )}
                      </TD>
                      <TD right muted w={colWidths["좋아요"]}>
                        {s?.likes_count != null ? s.likes_count.toLocaleString() : <span className="text-gray-300">-</span>}
                      </TD>
                      <TD right muted w={colWidths["댓글"]}>
                        {s?.comments_count != null ? s.comments_count.toLocaleString() : <span className="text-gray-300">-</span>}
                      </TD>
                      <td style={{ minWidth: colWidths["트렌드"] }} className="px-3 py-3 text-center">
                        <Sparkline stats={post.all_stats ?? []} postId={post.id} onClick={() => setTrendPost(post)} />
                      </td>
                      <td style={{ minWidth: colWidths["특이사항"] }} className="px-3 py-3">
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
                            className="text-xs cursor-text text-a-ink-muted hover:text-a-ink transition-colors line-clamp-2 block"
                          >
                            {post.notes || <span className="text-gray-300">-</span>}
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
        </div>
      </div>

      {showHelp && (
        <HelpModal title="협찬 모니터링 사용 안내" onClose={() => setShowHelp(false)}>
          <HelpSection title="이 탭에서 하는 일">
            <p className="text-a-ink-muted leading-relaxed">협찬 게시물의 조회수·좋아요·댓글 수를 날짜별로 자동 추적합니다. 매일 수치가 쌓여 성과 변화를 확인할 수 있습니다.</p>
          </HelpSection>
          <HelpSection title="버튼 설명">
            <HelpItem label="+ 게시물 추가 —">협찬 게시물 URL과 프로젝트명·상품명을 입력해 추적 대상으로 등록합니다.</HelpItem>
            <HelpItem label="지금 수집 —">등록된 모든 게시물의 현재 수치를 즉시 수집합니다. GitHub Actions 자동 수집과 별개로 수동으로도 실행 가능합니다.</HelpItem>
            <HelpItem label="새로고침 —">화면 데이터를 DB에서 다시 불러옵니다.</HelpItem>
          </HelpSection>
          <HelpSection title="표시 지표 정의">
            <HelpItem label="조회수 (재생수) —">videoPlayCount. 인스타그램 공개 조회수로 같은 사람이 여러 번 봐도 모두 카운트됩니다.</HelpItem>
            <HelpItem label="좋아요 / 댓글 —">likesCount / commentsCount. 게시물의 좋아요·댓글 수입니다.</HelpItem>
            <HelpItem label="조회당비용 —">비용 ÷ videoPlayCount (재생수)</HelpItem>
            <HelpItem label="도달당비용 —">비용 ÷ 도달수(reach_count). 실제 도달 인원 기준 효율입니다.</HelpItem>
          </HelpSection>
          <HelpSection title="📌 지표 평가 기준 (2025ver)">
            <HelpItem label="평균 조회수 —">BEST 10만↑ / GOOD 7만↑ / BAD 7만↓ · 최근 1개월 릴스 기준, 알고리즘 떡상 건 제외</HelpItem>
            <HelpItem label="조회당비용 —">BEST 20원↓ / GOOD 20~24원 / SOSO 25~29원 / BAD 30원↑ · 핵심 필수 지표</HelpItem>
            <HelpItem label="조회율 (팔로워 대비) —">BEST 1↑ / GOOD 0↑ / BAD 음수 · videoPlayCount ÷ followersCount</HelpItem>
            <HelpItem label="참여율 E.R —">BEST 1%↑ / SOSO 0.5%↑ / BAD 0.5%↓ · (댓글+좋아요) ÷ videoPlayCount × 100</HelpItem>
          </HelpSection>
          <HelpSection title="자동 수집">
            <p className="text-a-ink-muted leading-relaxed">GitHub Actions에 의해 매일 자동으로 수치를 수집합니다. 별도 실행 없이도 일별 데이터가 쌓입니다.</p>
          </HelpSection>
        </HelpModal>
      )}

      {/* 게시물 추가 모달 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50" role="dialog" aria-modal="true" aria-labelledby="modal-add-title">
          <div className="bg-white rounded-[22px] p-6 w-96 shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 id="modal-add-title" className="font-semibold tracking-tight mb-4">게시물 추가</h2>
            <div className="space-y-3">
              <input placeholder="프로젝트명" value={form.project_name}
                onChange={e => setForm(p => ({ ...p, project_name: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
              <input placeholder="상품명" value={form.product_name}
                onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
              <select value={form.channel_type}
                onChange={e => setForm(p => ({ ...p, channel_type: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm text-a-ink focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition">
                <option value="">채널 분류 선택</option>
                {CHANNEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <input placeholder="게시물 URL" value={form.url}
                onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
              <input placeholder="비용 (원, 선택)" type="number" value={form.cost}
                onChange={e => setForm(p => ({ ...p, cost: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
              <p className="text-xs text-a-ink-muted">인플루언서 계정명과 게시일은 수집 실행 시 자동으로 가져옵니다.</p>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => { setShowAdd(false); setForm({ url: "", product_name: "", project_name: "", channel_type: "", cost: "" }); }}
                className="btn-ghost">취소</button>
              <button onClick={addPost} disabled={adding || !form.url} className="btn-primary px-5 py-2 text-sm">
                {adding ? "추가 중..." : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpload && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[22px] p-6 w-[820px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-1">CSV 일괄 업로드</h2>
            <p className="text-xs text-a-ink-muted mb-4">컬럼 순서: 프로젝트명, 상품명, 채널분류, 게시물URL, 인플루언서명, 게시일, 비용, 도달수 (5~8번째 컬럼 생략 가능)</p>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={downloadTemplate}
                className="text-xs px-3.5 py-1.5 rounded-full border border-a-hairline text-a-ink-muted hover:bg-a-parchment transition">
                템플릿 다운로드
              </button>
              <label className="text-xs px-3.5 py-1.5 rounded-full border border-a-blue text-a-blue bg-blue-50 hover:bg-blue-100 transition cursor-pointer">
                파일 선택
                <input type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
              </label>
            </div>
            {csvRows.length > 0 && (
              <div className="border border-a-hairline rounded-[10px] overflow-hidden mb-4">
                <div className="px-3 py-2 bg-a-parchment/60 text-xs text-a-ink-muted border-b border-a-hairline">
                  {csvRows.length}개 행 인식됨
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-a-hairline text-a-ink-muted">
                        <th className="px-3 py-1.5 text-left font-medium">프로젝트명</th>
                        <th className="px-3 py-1.5 text-left font-medium">상품명</th>
                        <th className="px-3 py-1.5 text-left font-medium">채널분류</th>
                        <th className="px-3 py-1.5 text-left font-medium">URL</th>
                        <th className="px-3 py-1.5 text-left font-medium">인플루언서명</th>
                        <th className="px-3 py-1.5 text-left font-medium">게시일</th>
                        <th className="px-3 py-1.5 text-right font-medium">비용</th>
                        <th className="px-3 py-1.5 text-right font-medium">도달수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} className="border-b border-a-divider last:border-0">
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.project_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.product_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.channel_type ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-blue max-w-[120px] truncate">{r.url}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.account_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.posted_at ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted text-right">{r.cost != null ? r.cost.toLocaleString() : "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted text-right">{r.reach_count != null ? r.reach_count.toLocaleString() : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowUpload(false); setCsvRows([]); }} className="btn-ghost">취소</button>
              <button onClick={uploadCsvRows} disabled={uploading || csvRows.length === 0} className="btn-primary px-5 py-2 text-sm">
                {uploading ? "업로드 중..." : `${csvRows.length}개 등록`}
              </button>
            </div>
          </div>
        </div>
      )}

      {trendPost && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setTrendPost(null)}>
          <div className="bg-white rounded-[22px] p-6 w-[680px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-semibold tracking-tight">
                  {trendPost.account_name ?? trendPost.influencers?.name ?? "-"}
                </h2>
                <p className="text-xs text-a-ink-muted mt-0.5">
                  {[trendPost.project_name, trendPost.product_name].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button onClick={() => setTrendPost(null)}
                className="text-a-ink-muted hover:text-a-ink text-xl leading-none transition">×</button>
            </div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest">
                조회수 트렌드
              </p>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-0.5 bg-a-blue" />
                  <span className="text-a-ink-muted">조회수</span>
                </div>
                {trendLoading && <span className="text-gray-300">로딩 중...</span>}
              </div>
            </div>
            <LineChart
              data={(trendPost.all_stats ?? [])
                .filter(s => s.play_count != null)
                .map(s => ({ date: s.measured_at, value: s.play_count! }))}
              height={220}
              gradId="modalGrad"
            />
          </div>
        </div>
      )}

      {showTimeoutError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowTimeoutError(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[420px] p-7">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-semibold text-red-500 tracking-[0.1em] uppercase mb-1">시간 초과</p>
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">모니터링 지연 안내</h2>
              </div>
              <button onClick={() => setShowTimeoutError(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <p className="text-sm text-a-ink-muted leading-relaxed mb-5">
              5분 내에 모니터링이 완료되지 않았습니다. 작업은 백그라운드에서 계속 실행 중입니다. 완료 후 새로고침 버튼을 눌러주세요.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowTimeoutError(false)}
                className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment transition">닫기</button>
              <button onClick={() => { setShowTimeoutError(false); refresh(); }}
                className="text-xs px-4 py-2 rounded-full bg-a-blue text-white hover:bg-a-blue-hover transition">새로고침</button>
            </div>
          </div>
        </div>
      )}
      <ToastContainer toasts={toasts} />
    </div>
  );
}
