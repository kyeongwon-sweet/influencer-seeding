"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";
import { MIN_ENTRY_DATE, maxDateKST, isValidEntryDate } from "@/lib/dateRule";

type DailyStats = {
  measured_at: string;
  play_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  created_at?: string | null; // 적재(수집) 시각 — 마지막 업데이트 표시용
  play_collected?: boolean;   // 원본 조회수가 실제 수집됐는지 (mono 보정 전) — 당일 반영 판정용
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
  ended_at: string | null;
  influencers: { id: string; name: string; platform: string; post_type: string | null; category?: string | null } | null;
  latest_stats: DailyStats | null;
  prev_stats: DailyStats | null;
  all_stats: DailyStats[];
};

type CsvRow = { url: string; project_name: string | null; product_name: string | null; channel_type: string | null; account_name: string | null; posted_at: string | null; cost: number | null; reach_count: number | null };

type B2bDaily = {
  date: string;
  dumbuk_order: number | null; dumbuk_profit: number | null; dumbuk_conv_pl: number | null; dumbuk_ad_cost: number | null; dumbuk_contribution: number | null;
  jjondeuk_order: number | null; jjondeuk_profit: number | null; jjondeuk_conv_pl: number | null; jjondeuk_ad_cost: number | null; jjondeuk_contribution: number | null;
  total_order: number | null; total_contribution: number | null;
};

type Filters = { name: string; project: string; products: string[]; type: string; channelTypes: string[]; pdNames: string[]; dateFrom: string; dateTo: string; postedFrom: string; postedTo: string };
const INIT_FILTERS: Filters = { name: "", project: "", products: [], type: "all", channelTypes: [], pdNames: [], dateFrom: "", dateTo: "", postedFrom: "", postedTo: "" };
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
        "relative px-3 py-3 text-xs font-medium whitespace-nowrap select-none border-b border-a-hairline",
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

function TD({ children, right, muted, col, highlighted, w, leftPos, fixed }: {
  children: React.ReactNode; right?: boolean; muted?: boolean; col?: string; highlighted?: boolean;
  w?: number; leftPos?: number; fixed?: boolean;
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

// 소재명 규칙(파일명 생성기)으로 작성된 project_name을 17개 차원으로 파싱.
// 예: [26.06]F_V_DB혼_바이럴_상시_바이럴형_CU단독강조_var1.릴스_퀄리티근황.X_1P_황경원_260615_빙과_이수현
const PROJECT_PARSE_COLS = [
  "제작월", "채널구분", "영상/이미지 구분", "제품코드", "광고종류", "스킴명", "대분류 포맷",
  "소분류 연출", "배리에이션 여부", "지면 유형", "상세연출(소재구분)", "프로젝트",
  "파트 구분", "마케터", "집행시작일", "본부 구분", "PD/디자이너",
] as const;

function parseProjectName(name: string | null | undefined): Record<string, string> {
  const r: Record<string, string> = {};
  for (const c of PROJECT_PARSE_COLS) r[c] = "";
  if (!name || !name.startsWith("[")) return r;
  const parts = name.split("_");
  if (parts.length < 3) return r;
  const m = parts[0].match(/(\[.+?\])(.*)/);
  if (m) { r["제작월"] = m[1]; r["채널구분"] = m[2]; }
  if (parts.length > 1) r["영상/이미지 구분"] = parts[1];
  if (parts.length > 2) r["제품코드"] = parts[2];
  if (parts.length > 3) r["광고종류"] = parts[3];
  if (parts.length > 4) r["스킴명"] = parts[4];
  if (parts.length > 5) r["대분류 포맷"] = parts[5];
  if (parts.length > 6) r["소분류 연출"] = parts[6];
  if (parts.length > 7) { const kl = parts[7].split("."); r["배리에이션 여부"] = kl[0]; r["지면 유형"] = kl.slice(1).join("."); }
  if (parts.length > 8) { const mn = parts[8].split("."); r["상세연출(소재구분)"] = mn[0]; r["프로젝트"] = mn.slice(1).join("."); }
  if (parts.length > 9) r["파트 구분"] = parts[9];
  if (parts.length > 10) r["마케터"] = parts[10];
  if (parts.length > 11) r["집행시작일"] = parts[11];
  if (parts.length > 12) r["본부 구분"] = parts[12];
  if (parts.length > 13) r["PD/디자이너"] = parts.slice(13).join("_").replace(/\.(mp4|mov|png|jpe?g)$/i, "");
  return r;
}

// 게시물의 PD/디자이너 (파싱 불가 시 빈 문자열)
function pdOf(projectName: string | null | undefined): string {
  return parseProjectName(projectName)["PD/디자이너"].trim();
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

// "전체 전환 광고비" 클릭 시 이동할 Meta 광고 관리자 링크
const META_ADS_MANAGER_URL = "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=363574841093560&attribution_windows=default&business_id=447480832673184&columns=name%2Cdelivery%2Crecommendations_guidance%2Cresults%2Ccost_per_result%2Cbudget%2Cspend%2Cimpressions%2Creach%2Cfrequency%2Ccpm%2Cactions%3Aomni_purchase%2Cschedule%2Cend_time%2Cattribution_setting%2Cbid%2Clast_significant_edit%2Cquality_score_organic%2Cquality_score_ectr%2Cquality_score_ecvr%2Ccampaign_name%2Cpurchase_roas%3Aomni_purchase&date=2023-05-10_2026-06-11%2Cmaximum&global_scope_id=447480832673184&insights_comparison_date=&insights_date=2023-05-10_2026-06-11%2Cmaximum&treenav=true&comparison_date=";

// "라라스윗 검색량" 클릭 시 이동할 네이버 데이터랩 링크
const NAVER_DATALAB_URL = "https://datalab.naver.com/keyword/trendResult.naver?hashKey=N_2bd38f2b4d0d20ffd665b46aaa1f1833";

// 상품별 검색량 라인 색상 팔레트
const PRODUCT_COLORS = ["#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#7c3aed", "#0d9488", "#c2410c", "#be123c"];

// 차트 구조 색상(라인/축/격자) 중앙화 — 값은 기존과 동일(렌더 무변경), 한 곳에서 관리해 변경 누락 방지
const CHART = {
  primary: "#3b82f6",              // 조회수 라인·면적·강조점
  axis: "#9ca3af",                 // 축 라벨, 인스타 프로필 방문선 등 회색
  grid: "#e5e7eb",                 // 격자선
  secondary: "#b3b3b3",            // 보조축(전체 전환 광고비)
  youtube: ["#d1d5db", "#cbd5e1"], // 유튜브 검색량 2색(아이스크림/라라스윗)
};
// "쫀득바 쫀득바"처럼 동일 단어가 반복된 헤더는 한 번만 표시
function productLabel(name: string): string {
  const parts = name.split(" ");
  return parts.length === 2 && parts[0] === parts[1] ? parts[0] : name;
}

// 도달수: 수동 입력값이 있으면 그 값, 없으면 조회수의 80% 자동 추정
function effectiveReach(reachCount: number | null | undefined, playCount: number | null | undefined): number | null {
  if (reachCount != null) return reachCount;
  if (playCount != null && playCount > 0) return Math.round(playCount * 0.8);
  return null;
}

function LineChart({ data, height = 160, gradId = "lcGrad", postsOnDate, lsData, secondaryData, secondaryColor = "#ea580c", extraSeries, hidePrimary }: {
  data: { date: string; value: number }[];
  height?: number;
  gradId?: string;
  postsOnDate?: (date: string) => { name: string; url: string }[];
  lsData?: { date: string; ratio: number; value: number | null }[];
  secondaryData?: { date: string; value: number }[];
  secondaryColor?: string;
  extraSeries?: { name: string; color: string; members: { label: string; data: { date: string; value: number | null }[] }[] }[];
  hidePrimary?: boolean;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const [tipOtherOpen, setTipOtherOpen] = useState(false); // 툴팁 '그외' 토글
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeIdx = pinnedIdx ?? hoverIdx;
  if (data.length < 2) return <div className="flex items-center justify-center py-8 text-xs text-a-ink-muted">데이터 없음</div>;
  const pl = 52, pr = 8, pt = 8, pb = 22;
  const VW = 560, VH = height;
  const cw = VW - pl - pr, ch = VH - pt - pb;
  // 봉우리(+부드러운 곡선이 위로 솟구치는 부분)가 상단에 닿아 잘리지 않도록 상단 여유 확보
  const chTop = Math.round(ch * 0.1);
  const vals = data.map(d => d.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const xS = (i: number) => (i / (data.length - 1)) * cw;
  const yS = (v: number) => ch - ((v - min) / range) * (ch - chTop);
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
    const lsY = (r: number) => ch - ((r - lsMin) / lsRange) * (ch - chTop);
    return mapped.map((p, j) => `${j === 0 ? "M" : "L"}${xS(p.i).toFixed(1)},${lsY(p.ratio).toFixed(1)}`).join(" ");
  })();

  const hoveredLsEntry = (() => {
    if (!lsData || activeIdx === null) return null;
    return lsData.find(d => d.date === data[activeIdx].date) ?? null;
  })();

  // 상품별 검색량 — 카테고리는 구성 상품 합산, 각 시리즈 독립 정규화
  const extraComputed = (extraSeries ?? []).map(s => {
    const memberMaps = s.members.map(m => ({ label: m.label, map: new Map(m.data.map(d => [d.date, d.value])) }));
    const summed = data.map(d => {
      let sum = 0, any = false;
      for (const mm of memberMaps) { const v = mm.map.get(d.date); if (v != null) { sum += v; any = true; } }
      return { date: d.date, value: (any ? sum : null) as number | null };
    });
    const mapped = summed.map((p, i) => ({ i, v: p.value })).filter(p => p.v !== null) as { i: number; v: number }[];
    let path: string | null = null;
    let dots: [number, number][] = [];
    if (mapped.length >= 1) {
      const vs = mapped.map(p => p.v);
      const mn = Math.min(...vs), mx = Math.max(...vs), rg = mx - mn || 1;
      const allEqual = mn === mx; // 값이 1개거나 전부 동일 → 중앙 높이에 표시
      const y = (v: number) => allEqual ? ch / 2 : ch - ((v - mn) / rg) * (ch - chTop);
      dots = mapped.map(p => [xS(p.i), y(p.v)] as [number, number]);
      if (mapped.length >= 2) {
        path = mapped.map((p, j) => `${j === 0 ? "M" : "L"}${xS(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
      }
    }
    return { name: s.name, color: s.color, memberMaps, summed, path, dots };
  });

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
            <stop offset="0%" stopColor={CHART.primary} stopOpacity="0.08" />
            <stop offset="100%" stopColor={CHART.primary} stopOpacity="0" />
          </linearGradient>
        </defs>
        <g transform={`translate(${pl},${pt})`}>
          {yTicks.map((tick, i) => (
            <g key={i}>
              <line x1={0} y1={yS(tick)} x2={cw} y2={yS(tick)} stroke={CHART.grid} strokeWidth="1" strokeDasharray="4,4" />
              <text x={-8} y={yS(tick)} textAnchor="end" dominantBaseline="middle" fontSize="7" fill={CHART.axis}>{fmtY(tick)}</text>
            </g>
          ))}
          {secondaryTicks && secondaryTicks.map((tick, i) => (
            <g key={`sec-${i}`} opacity="0">
              <text x={cw + 8} y={tick.y} textAnchor="start" dominantBaseline="middle" fontSize="6" fill="#666666">{fmtYSecondary(tick.val)}</text>
            </g>
          ))}
          {!hidePrimary && <path d={areaPath} fill={`url(#${gradId})`} />}
          {lsPath && <path d={lsPath} fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeDasharray="5 3" strokeLinecap="round" />}
          {extraComputed.map((s, i) => {
            if (!s.path) return null;
            const important = s.name === "B2B 최종이익";
            const faint = s.name === "인스타 프로필 방문" || s.name.startsWith("유튜브");
            return (
              <path key={`extra-${i}`} d={s.path} fill="none" stroke={s.color}
                strokeWidth={important ? 2.5 : faint ? 1 : 1.5}
                opacity={important ? 1 : faint ? 0.4 : 0.85}
                strokeLinejoin="round" strokeLinecap="round" />
            );
          })}
          {extraComputed.map((s, si) => !s.path && s.dots.map((d, di) => (
            <circle key={`xdot-${si}-${di}`} cx={d[0]} cy={d[1]} r={2.2} fill={s.color} />
          )))}
          {!hidePrimary && (
            <path d={linePath} fill="none" stroke={CHART.primary} strokeWidth="2.5"
              strokeLinejoin="round" strokeLinecap="round" />
          )}
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
                stroke={CHART.primary} strokeWidth="1" strokeDasharray="3,3" />
              {!hidePrimary && <circle cx={xS(activeIdx)} cy={yS(data[activeIdx].value)} r={3.5} fill={CHART.primary} />}
            </>
          )}
          {xLabelIdxs.map(i => (
            <text key={i} x={xS(i)} y={ch + 14} textAnchor="middle" fontSize="7" fill={CHART.axis}>
              {data[i].date.slice(5).replace("-", "/")}
            </text>
          ))}
        </g>
      </svg>
      {activeIdx !== null && (
        <div ref={tooltipRef}
          className="absolute top-1 bg-white border border-a-hairline rounded-[10px] px-3.5 py-2.5 shadow-[0_4px_16px_rgba(0,0,0,0.10)] text-xs z-20 min-w-[250px] w-max whitespace-nowrap"
          style={{ left: `${Math.min(Math.max(((pl + xS(activeIdx)) / VW) * 100, 15), 85)}%`, transform: "translateX(-50%)" }}
          onMouseEnter={() => setPinnedIdx(activeIdx)}
          onMouseLeave={() => { setPinnedIdx(null); setHoverIdx(null); }}>
          {/* 1. 날짜 (검정 볼드) · 조회수 */}
          <p className="font-bold text-a-ink mb-1">{data[activeIdx].date.replace(/-/g, ".")} · <span className="text-a-blue tabular-nums">{data[activeIdx].value.toLocaleString()}</span></p>
          {/* 2. 라라스윗 검색량 */}
          {hoveredLsEntry?.value != null && (
            <a href={NAVER_DATALAB_URL} target="_blank" rel="noreferrer"
              className="text-gray-500 tabular-nums hover:underline pointer-events-auto flex items-center gap-0.5">
              라라스윗 검색량: {hoveredLsEntry.value.toLocaleString()} ↗
            </a>
          )}
          {/* 3. B2B 최종이익 */}
          {(() => {
            const b = extraComputed.find(s => s.name === "B2B 최종이익");
            const v = b?.summed.find(p => p.date === data[activeIdx].date)?.value;
            if (v == null) return null;
            return <p className="tabular-nums font-medium" style={{ color: b!.color }}>B2B 최종이익: {v.toLocaleString()}원</p>;
          })()}
          {/* 4. 전체 전환 광고비 */}
          {hoveredSecondaryValue != null && (
            <a href={META_ADS_MANAGER_URL} target="_blank" rel="noreferrer"
              className="text-orange-600 tabular-nums hover:underline pointer-events-auto flex items-center gap-0.5">
              전체 전환 광고비: {hoveredSecondaryValue.toLocaleString()}원 ↗
            </a>
          )}
          {/* 5. 그외 (토글) — 유튜브 검색량 / 인스타 프로필 방문 / 상품별 */}
          {(() => {
            const date = data[activeIdx].date;
            const others = extraComputed.filter(s => s.name !== "B2B 최종이익" && s.summed.find(p => p.date === date)?.value != null);
            if (others.length === 0) return null;
            return (
              <div className="mt-1">
                <button type="button" onClick={() => setTipOtherOpen(o => !o)}
                  className="text-a-ink-muted hover:text-a-ink pointer-events-auto flex items-center gap-1">
                  그 외 <span className="text-[9px] leading-none">{tipOtherOpen ? "▲" : "▼"}</span>
                </button>
                {tipOtherOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    {others.map((s, i) => {
                      const total = s.summed.find(p => p.date === date)!.value!;
                      return (
                        <div key={`xo-${i}`}>
                          <p className="tabular-nums" style={{ color: s.color }}>{s.name}: {total.toLocaleString()}</p>
                          {s.memberMaps.length > 1 && (
                            <div className="pl-2 space-y-0.5">
                              {s.memberMaps.map(mm => {
                                const v = mm.map.get(date);
                                return <p key={mm.label} className="text-[11px] text-a-ink-muted tabular-nums">· {mm.label} {v != null ? v.toLocaleString() : "-"}</p>;
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
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
  const [showPdDropdown, setShowPdDropdown] = useState(false);
  const [form, setForm] = useState({ url: "", product_name: "", project_name: "", channel_type: "", cost: "" });
  const [adding, setAdding] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [filters, setFilters] = useState<Filters>(INIT_FILTERS);
  const [dateTooltip, setDateTooltip] = useState<{ date: string; x: number; y: number } | null>(null);
  const [b2bTip, setB2bTip] = useState<{ date: string; x: number; y: number } | null>(null);
  const [showOtherSeries, setShowOtherSeries] = useState(false); // 범례 '그외' 드롭다운(인스타·유튜브)
  const [lsSearchData, setLsSearchData] = useState<{ date: string; ratio: number; value: number | null }[]>([]);
  const [brandMetrics, setBrandMetrics] = useState<{ measured_at: string; yt_views: number | null; yt_unique_viewers: number | null; yt_search_views: number | null; ig_profile_views: number | null }[]>([]);
  const [ytTrends, setYtTrends] = useState<{ measured_at: string; keyword: string; value: number | null }[]>([]);
  const [b2bDaily, setB2bDaily] = useState<B2bDaily[]>([]); // B2B 일자별 현황 (본부공헌이익)
  const [lastUpdate, setLastUpdate] = useState<{ at: string | null; byEmail: string | null }>({ at: null, byEmail: null }); // 진짜 마지막 적재 시각 + 출처
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set()); // 범례 클릭으로 숨긴 시리즈
  const [productTrends, setProductTrends] = useState<{ brandKey: string; products: string[]; data: { date: string; values: Record<string, number | null> }[] }>({ brandKey: "", products: [], data: [] });
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showHelp, setShowHelp] = useState(false);
  const [trendPost, setTrendPost] = useState<Post | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [editCell, setEditCell] = useState<EditCell | null>(null);
  const [editCategory, setEditCategory] = useState<{ postId: string; infId: string; value: string } | null>(null);
  const [editPlayCount, setEditPlayCount] = useState<{ postId: string; value: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastCheckedIdx = useRef<number | null>(null); // 체크박스 Ctrl/Shift 범위 선택 기준점
  const [deleting, setDeleting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showTimeoutError, setShowTimeoutError] = useState(false);
  const [updatedPlayCounts, setUpdatedPlayCounts] = useState<Map<string, number | null>>(new Map());
  const [hoverUpdatedId, setHoverUpdatedId] = useState<string | null>(null);
  const [collectedAtLabel, setCollectedAtLabel] = useState<string>("");
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
    "채널분류": 78, "게시일": 104, "캡션": 200, "인플루언서": 130, "상품명": 110, "프로젝트명": 150, "비용": 120, "조회수": 100, "조회당비용": 110, "도달수": 100, "도달당비용": 110, "좋아요": 80, "댓글": 80, "트렌드": 90, "특이사항": 160, "삭제": 60,
  });
  const resizingRef = useRef<{ col: string; startX: number; startW: number; isSticky: boolean } | null>(null);

  const filteredPosts = useMemo(() => posts.filter(post => {
    const displayName = (post.account_name ?? post.influencers?.name ?? "").toLowerCase();

    // 제로비 판정: 조회수가 없거나 0
    const isZeroPost = !post.latest_stats || post.latest_stats.play_count === 0 || post.latest_stats.play_count == null;

    // 1️⃣ 모든 게시물에 적용되는 필터 (제로비도 포함)
    if (filters.name && !displayName.includes(filters.name.toLowerCase())) return false;
    if (filters.project && !(post.project_name ?? "").toLowerCase().includes(filters.project.toLowerCase())) return false;
    if (filters.products.length > 0 && !filters.products.includes(post.product_name ?? "")) return false;
    if (filters.type !== "all" && getPostType(post.url) !== filters.type) return false;
    if (filters.channelTypes.length > 0 && !filters.channelTypes.some(ct => (post.channel_type ?? "").replace(/\s+/g, "") === ct.replace(/\s+/g, ""))) return false;
    if (filters.pdNames.length > 0 && !filters.pdNames.includes(pdOf(post.project_name))) return false;

    // 게시일 필터 (posted_at 기준)
    if (filters.postedFrom && (!post.posted_at || post.posted_at < filters.postedFrom)) return false;
    if (filters.postedTo && (!post.posted_at || post.posted_at > filters.postedTo)) return false;

    // 📌 조회수 기간 필터(dateFrom/dateTo)는 게시물을 제외하지 않음
    // 대신 표시 데이터 범위만 필터링 (filteredStats에서 처리)

    return true;
  }), [posts, filters]);

  const productOptions = Array.from(
    new Set(posts.map(p => p.product_name).filter((p): p is string => Boolean(p)))
  ).sort();

  // PD/디자이너 옵션 — project_name이 파싱되는 게시물만 (빈 값 제외)
  const pdOptions = Array.from(
    new Set(posts.map(p => pdOf(p.project_name)).filter((v): v is string => Boolean(v)))
  ).sort((a, b) => a.localeCompare(b, "ko"));

  const hasFilter = filters.name !== "" || filters.project !== "" || filters.products.length > 0 || filters.type !== "all" || filters.channelTypes.length > 0 || filters.pdNames.length > 0 || filters.dateFrom !== "" || filters.dateTo !== "" || filters.postedFrom !== "" || filters.postedTo !== "";
  const colSpan = 17;

  // 마지막 수집 시각 = 최신 측정행의 적재 시각(created_at) 중 최대값 (게시물 추가 시각 아님)
  const lastMonitoredAt = posts.reduce<string | null>((latest, p) => {
    const t = p.latest_stats?.created_at ?? null;
    return t && (!latest || t > latest) ? t : latest;
  }, null);

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
          // 🛡️ 누적 조회수는 감소 불가 — 수집 오류로 낮아진 값은 직전 값 유지
          lastPlay     = s.play_count != null ? Math.max(lastPlay ?? s.play_count, s.play_count) : lastPlay;
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
    // 검색량 증감은 "실제 전날" 기준 — 표에서 일부 날짜(수집 누락)가 빠져도 정확하게,
    // lsSearchData(모든 날짜 보유)에서 직전일 값과 비교한다. (직전 표 행과 비교하면 누락일이 합산돼 왜곡됨)
    const lsSorted = [...(lsSearchData || [])].sort((a, b) => a.date.localeCompare(b.date));
    const lsSearchDelta = (date: string) => {
      const idx = lsSorted.findIndex(s => s.date === date);
      if (idx <= 0) return 0;
      return (lsSorted[idx].value ?? 0) - (lsSorted[idx - 1].value ?? 0);
    };
    // 오늘(아직 수집 중)은 미완성 데이터라 증감이 음수로 떠 혼란을 주므로 표에서 제외
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return dailyTotals.slice(1).map((d, i) => ({
      date:     d.date,
      play:     d.play     - dailyTotals[i].play,
      search:   lsSearchDelta(d.date),
      comments: d.comments - dailyTotals[i].comments,
    })).filter(d => d.date < todayKST);
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

  // 라라스윗 검색량 = 상품 검색량 시트의 브랜드 전체(B열) 컬럼으로 통일 (네이버 실시간 추정값 대신)
  useEffect(() => {
    const key = productTrends.brandKey;
    if (!key || !lsStartDate || !lsEndDate) { setLsSearchData([]); return; }
    const rows = productTrends.data
      .filter(r => r.date >= lsStartDate && r.date <= lsEndDate)
      .map(r => { const v = r.values[key]; return v == null ? null : { date: r.date, ratio: v, value: v }; })
      .filter((x): x is { date: string; ratio: number; value: number } => x !== null);
    setLsSearchData(rows);
  }, [productTrends, lsStartDate, lsEndDate]);

  useEffect(() => {
    fetch("/api/brand-metrics")
      .then(r => r.ok ? r.json() : [])
      .then(data => setBrandMetrics(Array.isArray(data) ? data : []))
      .catch(() => {});
    fetch("/api/youtube-trends")
      .then(r => r.ok ? r.json() : [])
      .then(data => setYtTrends(Array.isArray(data) ? data : []))
      .catch(() => {});
    fetch("/api/b2b-revenue")
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(d => setB2bDaily(Array.isArray(d?.rows) ? d.rows : []))
      .catch(() => {});
    fetch("/api/monitoring/last-update")
      .then(r => r.ok ? r.json() : { at: null, byEmail: null })
      .then(d => setLastUpdate({ at: d?.at ?? null, byEmail: d?.byEmail ?? null }))
      .catch(() => {});
  }, []);

  // '그외' 시리즈(인스타 프로필 방문 / 유튜브 검색량)는 기본 숨김 — 데이터 첫 로드 시 1회만 적용
  const otherSeriesInit = useRef(false);
  useEffect(() => {
    if (otherSeriesInit.current) return;
    const hasIg = brandMetrics.some(d => d.ig_profile_views != null);
    const ytKeywords = Array.from(new Set(ytTrends.map(t => t.keyword)));
    if (!hasIg && ytKeywords.length === 0) return;
    otherSeriesInit.current = true;
    setHiddenSeries(prev => {
      const next = new Set(prev);
      if (hasIg) next.add("인스타 프로필 방문");
      ytKeywords.forEach(kw => next.add(`유튜브 ${kw} 검색량`));
      return next;
    });
  }, [brandMetrics, ytTrends]);

  // 상품별 검색량 (Google Sheet)
  useEffect(() => {
    fetch("/api/product-search-trends")
      .then(r => r.ok ? r.json() : { products: [], data: [] })
      .then(d => setProductTrends({
        brandKey: typeof d?.brandKey === "string" ? d.brandKey : "",
        products: Array.isArray(d?.products) ? d.products : [],
        data: Array.isArray(d?.data) ? d.data : [],
      }))
      .catch(() => {});
  }, []);

  const productColorOf = (name: string) =>
    PRODUCT_COLORS[Math.max(0, productTrends.products.indexOf(name)) % PRODUCT_COLORS.length];

  // 칩 정의: "X X" 형태는 카테고리 → "…X"로 끝나는 모든 상품 합산, 그 외는 단독
  const productChips = useMemo(() => {
    const cols = productTrends.products;
    return cols.map(col => {
      const p = col.split(" ");
      const cat = p.length === 2 && p[0] === p[1] ? p[0] : null;
      const members = cat ? cols.filter(c => productLabel(c).endsWith(cat)) : [col];
      return { id: col, label: cat ?? productLabel(col), members };
    });
  }, [productTrends.products]);

  // 상단 상품 필터에서 선택된 상품 → 검색량 시리즈(라벨 매칭). 시트에 없는 상품은 라인 없음.
  const activeProductSeries = useMemo(
    () => filters.products
      .map(p => productChips.find(c => c.label === p))
      .filter((c): c is NonNullable<typeof c> => !!c),
    [filters.products, productChips]
  );

  useEffect(() => {
    loadPosts().finally(() => setLoading(false));
    checkAndResumeMonitoring();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // 광고비 조회 기간(YYYY-MM-DD 문자열). chartData 배열 참조가 아닌 '값'에 의존시켜
  // effect 무한 재요청(루프) 방지 — 87K 폭주 사고의 근본 수정.
  const { adFrom, adTo } = useMemo(() => ({
    adFrom: chartData.length >= 2 ? (chartData[0].date || "").split('T')[0] : "",
    adTo: chartData.length >= 2 ? (chartData[chartData.length - 1].date || "").split('T')[0] : "",
  }), [chartData]);

  // 메인 차트용 광고비 데이터 로드 (날짜 범위가 실제로 바뀔 때만 호출)
  useEffect(() => {
    if (!adFrom || !adTo) {
      setMainAdCosts([]);
      return;
    }
    const url = new URL('/api/meta-ads', window.location.origin);
    url.searchParams.set('date_from', adFrom);
    url.searchParams.set('date_to', adTo);
    fetch(url.toString())
      .then(r => {
        if (!r.ok) throw new Error(`Meta API 오류: ${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(data => setMainAdCosts(Array.isArray(data) ? data : []))
      .catch(err => {
        console.error("[광고비 로드 오류]", err.message || err);
        setMainAdCosts([]);
      });
  }, [adFrom, adTo]);

  // 범례 클릭 토글 (해당 시리즈 숨김/표시)
  const seriesHidden = (k: string) => hiddenSeries.has(k);
  const toggleSeries = (k: string) => setHiddenSeries(prev => {
    const s = new Set(prev);
    if (s.has(k)) s.delete(k); else s.add(k);
    return s;
  });


  async function loadPosts() {
    const res = await fetch("/api/sponsored-posts", { cache: "no-store" });
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
        // 수집 시각 라벨 (KST) — 툴팁에 "M/D HH:mm 수집 데이터"로 표시
        const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
        setCollectedAtLabel(
          `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")} 수집 데이터`
        );

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

    // '오늘'(KST)은 수집 중이라 기본적으로 제외(전일자까지만 노출) — 미완성 null로 인한 증감 왜곡 방지.
    // 단, 이 게시물의 오늘 값이 '실제 수집 완료'된 경우(play_collected 또는 likes 존재)에는 당일 값을 즉시 반영.
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    newPosts = newPosts.map(p => {
      const all = p.all_stats ?? [];
      const today = all.find(s => s.measured_at === todayKST);
      const todayCollected = !!today && (today.play_collected === true || today.likes_count != null);
      const stats = todayCollected ? all : all.filter(s => s.measured_at < todayKST);
      return {
        ...p,
        all_stats: stats,
        latest_stats: stats.length ? stats[stats.length - 1] : null,
        prev_stats: stats.length > 1 ? stats[stats.length - 2] : null,
      };
    });

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
          posted_at: isValidEntryDate(cols[5] || "") ? cols[5] : null,
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
      case "도달수": av = effectiveReach(a.reach_count, sa?.play_count) ?? -1; bv = effectiveReach(b.reach_count, sb?.play_count) ?? -1; break;
      case "비용": av = a.cost ?? -1; bv = b.cost ?? -1; break;
      case "조회당비용":
        av = (a.cost != null && sa?.play_count != null && sa.play_count > 0) ? a.cost / sa.play_count : Infinity;
        bv = (b.cost != null && sb?.play_count != null && sb.play_count > 0) ? b.cost / sb.play_count : Infinity;
        break;
      case "도달당비용": {
        const ra = effectiveReach(a.reach_count, sa?.play_count), rb = effectiveReach(b.reach_count, sb?.play_count);
        av = (a.cost != null && ra != null && ra > 0) ? a.cost / ra : Infinity;
        bv = (b.cost != null && rb != null && rb > 0) ? b.cost / rb : Infinity;
        break;
      }
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
      const reach = effectiveReach(post.reach_count, play);
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

  // 체크박스 클릭: Ctrl/Shift(또는 Cmd) + 클릭 시 직전 클릭~현재 사이를 전체 선택
  function handleRowCheck(idx: number, id: string, e: React.MouseEvent) {
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && lastCheckedIdx.current !== null) {
      const [a, b] = [lastCheckedIdx.current, idx].sort((x, y) => x - y);
      const rangeIds = sortedPosts.slice(a, b + 1).map(r => r.id);
      setSelected(prev => { const s = new Set(prev); rangeIds.forEach(rid => s.add(rid)); return s; });
    } else {
      toggleSelect(id);
    }
    lastCheckedIdx.current = idx;
  }

  function toggleSelectAll() {
    const ids = filteredPosts.map(p => p.id);
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(ids));
  }

  async function patchPost(postId: string, field: string, value: string) {
    // Escape 취소 후 onBlur 발화 방지: editCell이 이미 null이면 저장 안 함
    if (!editCell) return;
    if (field === "posted_at" && value && !isValidEntryDate(value)) {
      toast("게시일이 올바르지 않습니다. (2020-01-01 ~ 오늘 범위로 입력)", "error");
      return;
    }
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
            className="pointer-events-none fixed z-[9999] bg-white border border-a-hairline rounded-lg shadow-lg px-3 py-2 text-xs"
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
      {b2bTip && (() => {
        const r = b2bDaily.find(x => x.date === b2bTip.date);
        if (!r) return null;
        const won = (v: number | null) => v == null ? "-" : `${v.toLocaleString()}원`;
        const cnt = (v: number | null) => v == null ? "-" : v.toLocaleString();
        const Row = ({ label, d, j, won: asWon = true }: { label: string; d: number | null; j: number | null; won?: boolean }) => (
          <div className="flex items-center justify-between gap-4">
            <span className="text-a-ink-muted">{label}</span>
            <span className="tabular-nums">
              <span className="text-rose-600">{asWon ? won(d) : cnt(d)}</span>
              <span className="text-gray-300 mx-1">/</span>
              <span className="text-emerald-700">{asWon ? won(j) : cnt(j)}</span>
            </span>
          </div>
        );
        return (
          <div
            className="pointer-events-none fixed z-[9999] bg-white border border-a-hairline rounded-lg shadow-lg px-3 py-2.5 text-xs min-w-[230px]"
            style={{ right: `calc(100vw - ${b2bTip.x}px + 8px)`, top: b2bTip.y, transform: 'translateY(-50%)' }}
          >
            <div className="flex items-center justify-between gap-4 pb-1.5 mb-1.5 border-b border-a-hairline text-[11px] font-semibold">
              <span>{b2bTip.date.slice(5).replace("-", "/")}</span>
              <span><span className="text-rose-600">듬뿍바</span> <span className="text-gray-300">/</span> <span className="text-emerald-700">쫀득바</span></span>
            </div>
            <div className="space-y-0.5">
              <Row label="발주량" d={r.dumbuk_order} j={r.jjondeuk_order} won={false} />
              <Row label="이익" d={r.dumbuk_profit} j={r.jjondeuk_profit} />
              <Row label="전환 손익" d={r.dumbuk_conv_pl} j={r.jjondeuk_conv_pl} />
              <Row label="인지 광고비" d={r.dumbuk_ad_cost} j={r.jjondeuk_ad_cost} />
              <Row label="본부공헌이익" d={r.dumbuk_contribution} j={r.jjondeuk_contribution} />
            </div>
            <div className="flex items-center justify-between gap-4 pt-1.5 mt-1.5 border-t border-a-hairline font-semibold">
              <span className="text-a-ink">최종 이익</span>
              <span className={`tabular-nums ${(r.total_contribution ?? 0) < 0 ? "text-[#c0392b]" : "text-a-ink"}`}>{won(r.total_contribution)}</span>
            </div>
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
          {(lastUpdate.at ?? lastMonitoredAt) && (
            <span className="text-xs text-a-ink-muted whitespace-nowrap">
              마지막 업데이트 <span className="font-medium text-a-ink">{formatTimestamp(lastUpdate.at ?? lastMonitoredAt!)}</span>
              <span className="ml-1.5">
                {lastUpdate.byEmail
                  ? <span className="text-a-ink-muted">· {lastUpdate.byEmail.split("@")[0]}</span>
                  : <span className="text-emerald-600">· 자동 실행</span>}
              </span>
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
          {pdOptions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowPdDropdown(!showPdDropdown)}
                className={`filter-select ${filters.pdNames.length > 0 ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
              >
                {filters.pdNames.length === 0
                  ? "전체 PD/디자이너"
                  : filters.pdNames.length === 1
                  ? filters.pdNames[0]
                  : `${filters.pdNames[0]} 외 ${filters.pdNames.length - 1}`}
              </button>
              {showPdDropdown && (
                <div className="absolute top-full left-0 mt-1 bg-white border border-a-hairline rounded-[8px] shadow-lg z-50 w-48">
                  <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
                    <label className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                      <input type="checkbox" checked={filters.pdNames.length === 0}
                        onChange={() => setFilters(p => ({ ...p, pdNames: [] }))}
                        className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                      전체
                    </label>
                    {pdOptions.map(name => (
                      <label key={name} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1.5 rounded text-xs">
                        <input type="checkbox" checked={filters.pdNames.includes(name)}
                          onChange={e => {
                            if (e.target.checked) setFilters(p => ({ ...p, pdNames: [...p.pdNames, name] }));
                            else setFilters(p => ({ ...p, pdNames: p.pdNames.filter(x => x !== name) }));
                          }}
                          className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                        {name}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
              return (
                <div className="flex rounded-[10px] border border-a-hairline bg-a-parchment/60 p-0.5 gap-0.5">
                  {presets.map(p => {
                    const active = filters.dateFrom === p.from && filters.dateTo === p.to;
                    return (
                      <button key={p.label}
                        onClick={() => setFilters(prev => active ? { ...prev, dateFrom: "", dateTo: "" } : { ...prev, dateFrom: p.from, dateTo: p.to })}
                        className={`px-3.5 py-1.5 rounded-[7px] text-xs transition whitespace-nowrap ${active ? "bg-white shadow-sm text-a-ink font-semibold" : "text-a-ink-muted hover:text-a-ink"}`}>
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              );
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
                // 라라스윗 검색량 총합 = 조회 기간 동안의 일자별 절대검색량(사이트 보정값) 합계
                // (차트 점선 '검색량'과 동일 기준. chartData는 조회수라 검색량과 무관 → lsSearchData 사용)
                const searchTotalSum = (lsSearchData ?? []).reduce((acc, d) => acc + (d.value ?? 0), 0);
                // B2B 최종이익(본부공헌이익 합) 월 누계 — 오늘까지 실데이터만(미래 계획행 제외)
                const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
                const b2bTotal = b2bDaily
                  .filter(d => d.date <= today)
                  .reduce((acc, d) => acc + (d.total_contribution ?? 0), 0);
                // 전주 대비: 최근 7일 합 vs 직전 7일 합 (일별 흐름값 기준)
                const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
                const cutLast = addDays(today, -6), cutPrior = addDays(today, -13);
                const wow = (daily: { date: string; v: number }[]) => {
                  let last = 0, prior = 0;
                  for (const x of daily) {
                    if (x.date >= cutLast && x.date <= today) last += x.v;
                    else if (x.date >= cutPrior && x.date < cutLast) prior += x.v;
                  }
                  return prior === 0 ? null : (last - prior) / Math.abs(prior) * 100;
                };
                const playInc = dailyTotals.map((d, i) => ({ date: d.date, v: i > 0 ? d.play - dailyTotals[i - 1].play : 0 }));
                return [
                  { label: "조회수 합계", value: totalPlayCount, color: "text-a-ink", suffix: "", delta: wow(playInc) },
                  { label: "라라스윗 검색량 총합", value: searchTotalSum, color: "text-gray-600", suffix: "", delta: wow((lsSearchData ?? []).map(d => ({ date: d.date, v: d.value ?? 0 }))) },
                  { label: "B2B 최종이익", value: b2bTotal, color: b2bTotal < 0 ? "text-rose-600" : "text-green-600", suffix: "원", delta: wow(b2bDaily.map(d => ({ date: d.date, v: d.total_contribution ?? 0 }))) },
                ];
              })().map((item, i) => (
                <div key={i} className={`flex-1 px-6 py-5 ${i > 0 ? "border-l border-a-hairline" : ""}`}>
                  <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest mb-1.5">{item.label}</p>
                  <p className={`text-[28px] font-bold tabular-nums tracking-tight leading-none ${item.color}`}>{item.value.toLocaleString()}{item.suffix}</p>
                  {item.delta != null && (
                    <p className={`mt-1 text-[11px] font-medium tabular-nums ${item.delta > 0 ? "text-emerald-600" : item.delta < 0 ? "text-rose-500" : "text-gray-400"}`}>
                      {item.delta > 0 ? "▲" : item.delta < 0 ? "▼" : ""} {item.delta > 0 ? "+" : ""}{item.delta.toFixed(1)}% <span className="text-gray-400 font-normal">전주 대비</span>
                    </p>
                  )}
                </div>
              ))}
            </div>
            {/* 차트 + 테이블 */}
            <div className="flex divide-x divide-a-hairline">
              {/* 차트 */}
              <div className="flex-1 min-w-0 px-6 py-5">
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                  <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest">조회수 트렌드 (누적)</p>
                  <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap justify-end">
                    {/* 1. 조회수 */}
                    <button type="button" onClick={() => toggleSeries("조회수")}
                      className={`flex items-center gap-1.5 transition-opacity ${seriesHidden("조회수") ? "opacity-30" : ""}`}>
                      <div className="w-3 h-1 rounded-sm bg-a-blue" />
                      <span className="text-xs font-semibold text-a-ink">조회수</span>
                    </button>
                    {/* 2. 검색량 */}
                    {lsSearchData && lsSearchData.length > 0 && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => toggleSeries("검색량")}
                          className={`flex items-center gap-1.5 transition-opacity ${seriesHidden("검색량") ? "opacity-30" : ""}`}>
                          <svg width="12" height="4" viewBox="0 0 20 4"><line x1="0" y1="2" x2="20" y2="2" stroke="#f59e0b" strokeWidth="3" strokeDasharray="5 3" strokeLinecap="round" /></svg>
                          <span className="text-xs font-semibold text-a-ink">검색량</span>
                        </button>
                        <a href={NAVER_DATALAB_URL} target="_blank" rel="noreferrer"
                          className="text-[10px] text-a-ink-muted hover:text-a-ink">↗</a>
                      </div>
                    )}
                    {/* 3. B2B 최종이익 */}
                    {b2bDaily.some(d => d.total_contribution != null) && (
                      <button type="button" onClick={() => toggleSeries("B2B 최종이익")}
                        className={`flex items-center gap-1.5 transition-opacity ${seriesHidden("B2B 최종이익") ? "opacity-30" : ""}`}>
                        <div className="w-3 h-1 rounded-sm" style={{ backgroundColor: "#16a34a" }} />
                        <span className="text-xs font-semibold text-a-ink">B2B 최종이익</span>
                      </button>
                    )}
                    {/* 4. 전체 전환 광고비 */}
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => toggleSeries("전체 전환 광고비")}
                        className={`flex items-center gap-1.5 transition-opacity ${seriesHidden("전체 전환 광고비") ? "opacity-30" : ""}`}>
                        <div className="w-2 h-0.5 bg-gray-400" />
                        <span className="text-xs text-a-ink-muted">전체 전환 광고비</span>
                      </button>
                      <a href={META_ADS_MANAGER_URL} target="_blank" rel="noreferrer"
                        className="text-[10px] text-a-ink-muted hover:text-a-ink">↗</a>
                    </div>
                    {/* 5. 상품별 검색량 (상품 필터 선택 시) */}
                    {activeProductSeries.map(c => (
                      <button type="button" key={c.id} onClick={() => toggleSeries(c.label)}
                        className={`flex items-center gap-1.5 transition-opacity ${seriesHidden(c.label) ? "opacity-30" : ""}`}>
                        <div className="w-2 h-0.5" style={{ backgroundColor: productColorOf(c.id) }} />
                        <span className="text-xs text-a-ink-muted">{c.label}</span>
                      </button>
                    ))}
                    {/* 6. 그외 (클릭 시 인스타 프로필 방문 / 유튜브 검색량 토글) */}
                    {(brandMetrics.some(d => d.ig_profile_views != null) || ytTrends.length > 0) && (
                      <div className="relative">
                        <button type="button" onClick={() => setShowOtherSeries(v => !v)}
                          className="flex items-center gap-1 text-xs text-a-ink-muted hover:text-a-ink">
                          그 외 <span className="text-[9px] leading-none">▼</span>
                        </button>
                        {showOtherSeries && (
                          <>
                            <div className="fixed inset-0 z-20" onClick={() => setShowOtherSeries(false)} />
                            <div className="absolute right-0 top-full mt-1.5 z-30 bg-white border border-a-hairline rounded-lg shadow-lg p-2.5 space-y-2 w-max">
                              {brandMetrics.some(d => d.ig_profile_views != null) && (
                                <button type="button" onClick={() => toggleSeries("인스타 프로필 방문")}
                                  className={`flex items-center gap-1.5 w-full transition-opacity ${seriesHidden("인스타 프로필 방문") ? "opacity-30" : ""}`}>
                                  <div className="w-2 h-0.5 flex-shrink-0" style={{ backgroundColor: CHART.axis }} />
                                  <span className="text-xs text-a-ink-muted whitespace-nowrap">인스타 프로필 방문</span>
                                </button>
                              )}
                              {Array.from(new Set(ytTrends.map(t => t.keyword))).map((kw, i) => (
                                <button type="button" key={`yt-${kw}`} onClick={() => toggleSeries(`유튜브 ${kw} 검색량`)}
                                  className={`flex items-center gap-1.5 w-full transition-opacity ${seriesHidden(`유튜브 ${kw} 검색량`) ? "opacity-30" : ""}`}>
                                  <div className="w-2 h-0.5 flex-shrink-0" style={{ backgroundColor: CHART.youtube[i % 2] }} />
                                  <span className="text-xs text-a-ink-muted whitespace-nowrap">유튜브 {kw} 검색량</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <LineChart
                  data={chartData}
                  height={160}
                  gradId="summaryGrad"
                  hidePrimary={seriesHidden("조회수")}
                  lsData={seriesHidden("검색량") ? undefined : lsSearchData}
                  extraSeries={[
                    ...activeProductSeries.map(c => ({
                      name: c.label,
                      color: productColorOf(c.id),
                      members: c.members.map(col => ({
                        label: productLabel(col),
                        data: productTrends.data.map(row => ({ date: row.date, value: row.values[col] ?? null })),
                      })),
                    })),
                    // 라라스윗 공식 인스타 프로필 방문 — brandMetrics.ig_profile_views
                    ...(brandMetrics.some(d => d.ig_profile_views != null) ? [{
                      name: "인스타 프로필 방문",
                      color: CHART.axis,
                      members: [{
                        label: "인스타 프로필 방문",
                        data: brandMetrics.map(d => ({ date: d.measured_at, value: d.ig_profile_views })),
                      }],
                    }] : []),
                    // 유튜브 검색 트렌드 — 키워드별 (Google Trends gprop=youtube, 상대값 0~100)
                    ...Array.from(new Set(ytTrends.map(t => t.keyword))).map((kw, i) => ({
                      name: `유튜브 ${kw} 검색량`,
                      color: CHART.youtube[i % 2],
                      members: [{
                        label: kw,
                        data: ytTrends.filter(t => t.keyword === kw).map(t => ({ date: t.measured_at, value: t.value })),
                      }],
                    })),
                    // B2B 최종이익 (본부공헌이익 합) — 미래 계획행 제외, 오늘까지만
                    ...(b2bDaily.some(d => d.total_contribution != null) ? [{
                      name: "B2B 최종이익",
                      color: "#16a34a",
                      members: [{
                        label: "B2B 최종이익",
                        data: b2bDaily
                          .filter(d => d.date <= new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10))
                          .map(d => ({ date: d.date, value: d.total_contribution })),
                      }],
                    }] : []),
                  ].filter(s => !seriesHidden(s.name))}
                  secondaryData={!seriesHidden("전체 전환 광고비") && mainAdCosts.length > 0 ? mainAdCosts.map(d => ({date: d.date, value: d.total_cost})) : undefined}
                  secondaryColor={CHART.secondary}
                  postsOnDate={(date) =>
                    filteredPosts
                      .filter(p => p.posted_at?.slice(0, 10) === date)
                      .map(p => ({ name: p.account_name ?? p.influencers?.name ?? '-', url: p.url }))
                  }
                />
              </div>
              {/* 증감 테이블 — 내용폭에 맞춰 고정(여백 최소화), 그래프가 나머지 차지 */}
              <div className="flex-none w-max flex flex-col self-start">
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
                    const b2bMap = new Map(b2bDaily.map(d => [d.date, d.total_contribution]));
                    return (
                      <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
                        <table className="mx-auto">
                          <thead className="sticky top-0 z-10 bg-white border-b border-a-hairline">
                            <tr>
                              <th className="pl-5 pr-3 py-2.5 text-left text-[11px] font-semibold text-a-ink-muted">날짜</th>
                              <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-a-ink-muted whitespace-nowrap">누적 조회수</th>
                              <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-a-ink-muted">검색량</th>
                              <th className="pl-3 pr-5 py-2.5 text-right text-[11px] font-semibold text-a-ink-muted whitespace-nowrap">B2B 최종이익</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reversed.map((d, i) => {
                              const dow = new Date(d.date).getDay();
                              const dayLabel = DAY_KO[dow];
                              const cls = dateColor(d.date);
                              function deltaCell(v: number | null | undefined, accent = "text-a-blue") {
                                if (v == null) return <td className="px-3 py-3 text-right text-gray-300">-</td>;
                                const pos = v > 0, neg = v < 0;
                                return (
                                  <td className={`px-3 py-3 text-right tabular-nums text-sm font-semibold ${pos ? accent : neg ? "text-emerald-600" : "text-gray-200"}`}>
                                    {pos ? "+" : ""}{v.toLocaleString()}
                                  </td>
                                );
                              }
                              return (
                                <tr key={i} className="border-b border-a-divider last:border-0 hover:bg-a-parchment/50 transition-colors">
                                  <td
                                    className={`pl-5 pr-3 py-3 text-sm font-bold tabular-nums whitespace-nowrap ${cls}`}
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
                                  {(() => {
                                    const v = b2bMap.get(d.date);
                                    if (v == null) return <td className="pl-3 pr-5 py-3 text-right text-gray-300">-</td>;
                                    return (
                                      <td
                                        className={`pl-3 pr-5 py-3 text-right tabular-nums text-sm font-semibold cursor-help ${v < 0 ? "text-[#c0392b]" : "text-emerald-700"}`}
                                        onMouseEnter={(e) => {
                                          const r = e.currentTarget.getBoundingClientRect();
                                          setB2bTip({ date: d.date, x: r.left, y: r.top + r.height / 2 });
                                        }}
                                        onMouseLeave={() => setB2bTip(null)}
                                      >
                                        {v.toLocaleString()}
                                      </td>
                                    );
                                  })()}
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
                    <text key={i} x={xi(i)} y={H - 8} textAnchor="middle" fontSize="8.5" fill={CHART.axis}>
                      {data[i].measured_at.slice(5).replace("-", "/")}
                    </text>
                  ))}
                </svg>
              </div>
            </div>
          );
        })()}

        <div className="bg-white rounded-[18px] border border-a-hairline overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-120px)]">
          {loading ? (
            <div className="p-8 text-center text-a-ink-muted text-sm">로딩 중...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-30">
                <tr className="border-b border-a-hairline">
                  <th className="pl-3 pr-1 py-3 sticky z-40 bg-white border-b border-a-hairline" style={{ left: 0, width: 36, minWidth: 36 }}>
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
                  <TH w={colWidths["인플루언서"]} fixed onResize={e => startResize("인플루언서", e)} {...sp("인플루언서")}>인플루언서</TH>
                  <TH w={colWidths["상품명"]} fixed onResize={e => startResize("상품명", e)} {...sp("상품명")}>상품명</TH>
                  <TH w={colWidths["프로젝트명"]} fixed onResize={e => startResize("프로젝트명", e)} {...sp("프로젝트명")}>프로젝트명</TH>
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
                  <TH right w={colWidths["도달수"]} onResize={e => startResize("도달수", e)} {...sp("도달수")}>
                    <span className="group/reach relative">
                      도달수
                      <div className="hidden group-hover/reach:block absolute top-full right-0 mt-1.5 z-[9999] bg-white border border-a-hairline rounded-[10px] px-3.5 py-3 shadow-lg min-w-[180px] pointer-events-none text-left font-normal normal-case tracking-normal">
                        <p className="text-[11px] text-a-ink-muted">조회수 × 80%로, 추정치입니다.</p>
                      </div>
                    </span>
                  </TH>
                  <TH right w={colWidths["도달당비용"]} onResize={e => startResize("도달당비용", e)} {...sp("도달당비용")}>도달당비용</TH>
                  <TH w={colWidths["캡션"]} fixed onResize={e => startResize("캡션", e)}>캡션</TH>
                  <TH right w={colWidths["좋아요"]} onResize={e => startResize("좋아요", e)} {...sp("좋아요")}>좋아요</TH>
                  <TH right w={colWidths["댓글"]} onResize={e => startResize("댓글", e)} {...sp("댓글")}>댓글</TH>
                  <TH className="text-center" w={colWidths["트렌드"]} onResize={e => startResize("트렌드", e)}>트렌드</TH>
                  <TH w={colWidths["특이사항"]} fixed onResize={e => startResize("특이사항", e)}>특이사항</TH>
                  <TH w={colWidths["삭제"]}></TH>
                </tr>
              </thead>
              <tbody>
                {sortedPosts.map((post, rowIdx) => {
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
                          checked={selected.has(post.id)} onChange={() => {}}
                          onClick={(e) => handleRowCheck(rowIdx, post.id, e)} />
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
                                className="flex-shrink-0 text-[10px] leading-none px-1 py-0.5 rounded bg-gray-100 text-gray-400 border border-gray-200">종료</span>
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
                      <TD muted w={colWidths["상품명"]} fixed>
                        {editCell?.postId === post.id && editCell?.field === "product_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "product_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "product_name", editCell.value); if (e.key === "Escape") { e.preventDefault(); setEditCell(null); }; }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "product_name", value: post.product_name ?? "" })}
                            className="block truncate cursor-text hover:text-a-blue transition-colors">
                            {post.product_name ?? "-"}
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
                                <p className="font-semibold text-red-500">{collectedAtLabel}</p>
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
                          (() => {
                            const eff = effectiveReach(post.reach_count, s?.play_count);
                            if (eff == null) return <span className="text-gray-300">-</span>;
                            const isAuto = post.reach_count == null;
                            return (
                              <span className={`hover:text-a-blue transition-colors ${isAuto ? "text-gray-400" : "text-a-ink-muted"}`}
                                title={isAuto ? "조회수의 80% 자동 추정" : undefined}>
                                {eff.toLocaleString()}
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <TD right muted w={colWidths["도달당비용"]}>
                        {(() => {
                          const eff = effectiveReach(post.reach_count, s?.play_count);
                          return post.cost != null && eff != null && eff > 0
                            ? (post.cost / eff).toFixed(2) + "원"
                            : <span className="text-gray-300">-</span>;
                        })()}
                      </TD>
                      <TD muted w={colWidths["캡션"]} fixed>
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
                      <td style={{ width: colWidths["특이사항"], minWidth: colWidths["특이사항"], maxWidth: colWidths["특이사항"] }} className="px-3 py-3">
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
