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

type Filters = { name: string; project: string; products: string[]; type: string; channelType: string; category: string; dateFrom: string; dateTo: string };
const INIT_FILTERS: Filters = { name: "", project: "", products: [], type: "all", channelType: "all", category: "all", dateFrom: "", dateTo: "" };
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

function fmt(v: number | null | undefined) {
  return v == null ? "-" : v.toLocaleString();
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

function LineChart({ data, height = 160, gradId = "lcGrad" }: { data: { date: string; value: number }[]; height?: number; gradId?: string }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (data.length < 2) return <div className="flex items-center justify-center py-8 text-xs text-a-ink-muted">데이터 없음</div>;
  const pl = 60, pr = 12, pt = 8, pb = 28;
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
  return (
    <div className="relative w-full">
      <svg width="100%" viewBox={`0 0 ${VW} ${VH}`} style={{ overflow: "visible" }}
        onMouseLeave={() => setHoverIdx(null)}>
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
              <text x={-8} y={yS(tick)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#9ca3af">{fmtY(tick)}</text>
            </g>
          ))}
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth="1.5"
            strokeLinejoin="round" strokeLinecap="round" />
          {data.map((_, i) => (
            <rect key={i} x={Math.max(0, xS(i) - cellW / 2)} y={0}
              width={cellW} height={ch} fill="transparent"
              onMouseEnter={() => setHoverIdx(i)} />
          ))}
          {hoverIdx !== null && (
            <>
              <line x1={xS(hoverIdx)} y1={0} x2={xS(hoverIdx)} y2={ch}
                stroke="#3b82f6" strokeWidth="1" strokeDasharray="3,3" />
              <circle cx={xS(hoverIdx)} cy={yS(data[hoverIdx].value)} r={3.5} fill="#3b82f6" />
            </>
          )}
          {xLabelIdxs.map(i => (
            <text key={i} x={xS(i)} y={ch + 16} textAnchor="middle" fontSize="10" fill="#9ca3af">
              {data[i].date.slice(5).replace("-", "/")}
            </text>
          ))}
        </g>
      </svg>
      {hoverIdx !== null && (
        <div className="pointer-events-none absolute top-2 bg-white border border-a-hairline rounded-[8px] px-3 py-2 shadow-sm text-xs z-10"
          style={{ left: `${((pl + xS(hoverIdx)) / VW) * 100}%`, transform: "translateX(-50%)" }}>
          <p className="text-a-ink-muted">{data[hoverIdx].date.replace(/-/g, "/")}</p>
          <p className="font-semibold tabular-nums font-numeric">{data[hoverIdx].value.toLocaleString()}</p>
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
  const [form, setForm] = useState({ url: "", product_name: "", project_name: "", channel_type: "", cost: "" });
  const [adding, setAdding] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [filters, setFilters] = useState<Filters>(INIT_FILTERS);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showHelp, setShowHelp] = useState(false);
  const [trendPost, setTrendPost] = useState<Post | null>(null);
  const [editCell, setEditCell] = useState<EditCell | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showTimeoutError, setShowTimeoutError] = useState(false);
  const runningJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // column widths for drag-resize
  const [stickyColWidths, setStickyColWidths] = useState<Record<string, number>>({
    "증분량": 80,
  });
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    "채널분류": 100, "게시일": 104, "캡션": 200, "인플루언서": 180, "상품명": 150, "프로젝트명": 150, "비용": 120, "조회수": 100, "조회당비용": 110, "도달수": 100, "도달당비용": 110, "트렌드": 90, "특이사항": 160, "삭제": 60,
  });
  const resizingRef = useRef<{ col: string; startX: number; startW: number; isSticky: boolean } | null>(null);

  const filteredPosts = posts.filter(post => {
    const displayName = (post.account_name ?? post.influencers?.name ?? "").toLowerCase();
    if (filters.name && !displayName.includes(filters.name.toLowerCase())) return false;
    if (filters.project && !(post.project_name ?? "").toLowerCase().includes(filters.project.toLowerCase())) return false;
    if (filters.products.length > 0 && !filters.products.includes(post.product_name ?? "")) return false;
    if (filters.type !== "all" && getPostType(post.url) !== filters.type) return false;
    if (filters.channelType !== "all" && post.channel_type !== filters.channelType) return false;
    if (filters.category !== "all" && (post.influencers?.category ?? null) !== filters.category) return false;
    if (filters.dateFrom && (!post.posted_at || post.posted_at < filters.dateFrom)) return false;
    if (filters.dateTo && (!post.posted_at || post.posted_at > filters.dateTo)) return false;
    return true;
  });

  const productOptions = Array.from(
    new Set(posts.map(p => p.product_name).filter((p): p is string => Boolean(p)))
  ).sort();

  const hasFilter = filters.name !== "" || filters.project !== "" || filters.products.length > 0 || filters.type !== "all" || filters.channelType !== "all" || filters.category !== "all" || filters.dateFrom !== "" || filters.dateTo !== "";
  const colSpan = 16;

  const lastMonitoredAt = posts.length > 0
    ? posts.reduce((latest, p) => {
        const t = p.latest_stats?.measured_at ?? p.created_at;
        return t > latest ? t : latest;
      }, posts[0].latest_stats?.measured_at ?? posts[0].created_at)
    : null;

  const chartData = useMemo(() => {
    const map = new Map<string, number>();
    for (const post of filteredPosts) {
      for (const s of post.all_stats ?? []) {
        const v = pickMetric(s);
        if (v != null) map.set(s.measured_at, (map.get(s.measured_at) ?? 0) + v);
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  }, [filteredPosts]);

  const totalPlayCount = filteredPosts.reduce((s, p) => s + (p.latest_stats?.play_count ?? 0), 0);
  const totalLikes = filteredPosts.reduce((s, p) => s + (p.latest_stats?.likes_count ?? 0), 0);
  const totalComments = filteredPosts.reduce((s, p) => s + (p.latest_stats?.comments_count ?? 0), 0);

  const dailyTotals = useMemo(() => {
    const map = new Map<string, { play: number; likes: number; comments: number }>();
    for (const post of filteredPosts) {
      for (const s of post.all_stats ?? []) {
        const e = map.get(s.measured_at) ?? { play: 0, likes: 0, comments: 0 };
        map.set(s.measured_at, {
          play:     e.play     + (s.play_count     ?? 0),
          likes:    e.likes    + (s.likes_count    ?? 0),
          comments: e.comments + (s.comments_count ?? 0),
        });
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
  }, [filteredPosts]);

  const deltaChartData = useMemo(() => {
    return chartData.slice(1).map((d, i) => ({
      date: d.date,
      value: d.value - chartData[i].value,
    }));
  }, [chartData]);

  const deltaTableData = useMemo(() => {
    if (dailyTotals.length < 2) return [];
    return dailyTotals.slice(1).map((d, i) => ({
      date:     d.date,
      play:     d.play     - dailyTotals[i].play,
      likes:    d.likes    - dailyTotals[i].likes,
      comments: d.comments - dailyTotals[i].comments,
    }));
  }, [dailyTotals]);

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

  useEffect(() => {
    loadPosts().finally(() => setLoading(false));
    checkAndResumeMonitoring();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  async function loadPosts() {
    const res = await fetch("/api/sponsored-posts");
    const json = await res.json();
    if (!res.ok) { toast("데이터 로드에 실패했습니다: " + (json?.error ?? "오류"), "error"); return; }
    setPosts(Array.isArray(json) ? json : []);
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
        cost: form.cost ? Number(form.cost) : null,
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
          channel_type: cols[2] || null,
          url: cols[3] ?? "",
          account_name: cols[4] || null,
          posted_at: cols[5] || null,
          cost: cols[6] ? Number(cols[6]) : null,
          reach_count: cols[7] ? Number(cols[7]) : null,
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
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, [field]: stored } : p));
    } else {
      toast("저장에 실패했습니다.", "error");
    }
    setEditCell(null);
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
        <div className="bg-white rounded-[14px] border border-a-hairline px-4 py-2.5 mb-4 flex items-center gap-2 flex-wrap">
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
          <div className="w-px h-4 bg-a-hairline mx-0.5" />
          <select
            value={filters.type}
            onChange={e => setFilters(p => ({ ...p, type: e.target.value }))}
            className={`filter-select ${filters.type !== "all" ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
          >
            <option value="all">전체 유형</option>
            {POST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={filters.channelType}
            onChange={e => setFilters(p => ({ ...p, channelType: e.target.value }))}
            className={`filter-select ${filters.channelType !== "all" ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
          >
            <option value="all">전체 채널분류</option>
            {CHANNEL_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select
            value={filters.category}
            onChange={e => setFilters(p => ({ ...p, category: e.target.value }))}
            className={`filter-select ${filters.category !== "all" ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
          >
            <option value="all">전체 카테고리</option>
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.desc}</option>)}
          </select>
          <div className="w-px h-4 bg-a-hairline mx-0.5" />
          <div className="flex items-center gap-1.5">
            <input type="date" value={filters.dateFrom}
              onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))}
              className={`filter-input ${filters.dateFrom ? "border-a-blue" : ""}`} />
            <span className="text-xs text-a-ink-muted">–</span>
            <input type="date" value={filters.dateTo}
              onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))}
              className={`filter-input ${filters.dateTo ? "border-a-blue" : ""}`} />
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
              {[
                { label: "조회수 합계", value: totalPlayCount, color: "text-a-ink" },
                { label: "좋아요 합계", value: totalLikes, color: "text-rose-500" },
                { label: "댓글 합계", value: totalComments, color: "text-blue-500" },
              ].map((item, i) => (
                <div key={i} className={`flex-1 px-6 py-5 ${i > 0 ? "border-l border-a-hairline" : ""}`}>
                  <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest mb-1.5">{item.label}</p>
                  <p className={`text-[28px] font-bold tabular-nums tracking-tight leading-none ${item.color}`}>{item.value.toLocaleString()}</p>
                </div>
              ))}
            </div>
            {/* 차트 + 테이블 */}
            <div className="flex divide-x divide-a-hairline">
              {/* 차트 */}
              <div className="flex-[3] px-6 py-5">
                <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest mb-3">조회수 트렌드 (누적)</p>
                <LineChart data={chartData} height={180} gradId="summaryGrad" />
              </div>
              {/* 증감 테이블 */}
              <div className="flex-[2] flex flex-col">
                <div className="px-5 py-4 border-b border-a-hairline">
                  <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest">일자별 조회수 증감</p>
                </div>
                {deltaTableData.length === 0 ? (
                  <div className="flex items-center justify-center flex-1 text-sm text-a-ink-muted py-10">측정 데이터 2일 이상 필요</div>
                ) : (
                  <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
                    <table className="w-full">
                      <thead className="sticky top-0 z-10 bg-white border-b border-a-hairline">
                        <tr>
                          <th className="px-5 py-2.5 text-left text-[10px] font-semibold text-a-ink-muted uppercase tracking-widest w-16">날짜</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-a-ink-muted uppercase tracking-widest">조회수</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-a-ink-muted uppercase tracking-widest">좋아요</th>
                          <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-a-ink-muted uppercase tracking-widest">댓글</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[{ date: dailyTotals[0].date, play: 0, likes: 0, comments: 0 }, ...deltaTableData].map((d, i) => {
                          function deltaCell(v: number, accent = "text-red-500") {
                            const pos = v > 0, neg = v < 0;
                            return (
                              <td className={`px-4 py-3 text-right tabular-nums text-sm font-semibold ${pos ? accent : neg ? "text-emerald-600" : "text-gray-200"}`}>
                                {pos ? "+" : ""}{v.toLocaleString()}
                              </td>
                            );
                          }
                          return (
                            <tr key={i} className="border-b border-a-divider last:border-0 hover:bg-a-parchment/50 transition-colors">
                              <td className="px-5 py-3 text-sm font-bold text-a-ink tabular-nums">{d.date.slice(5).replace("-", "/")}</td>
                              {deltaCell(d.play, "text-a-blue")}
                              {deltaCell(d.likes, "text-rose-500")}
                              {deltaCell(d.comments, "text-purple-500")}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

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
                  <TH w={colWidths["캡션"]} onResize={e => startResize("캡션", e)}>캡션</TH>
                  <TH w={colWidths["인플루언서"]} onResize={e => startResize("인플루언서", e)} {...sp("인플루언서")}>인플루언서</TH>
                  <TH w={colWidths["상품명"]} onResize={e => startResize("상품명", e)} {...sp("상품명")}>상품명</TH>
                  <TH w={colWidths["프로젝트명"]} onResize={e => startResize("프로젝트명", e)} {...sp("프로젝트명")}>프로젝트명</TH>
                  <TH right w={colWidths["비용"]} onResize={e => startResize("비용", e)} {...sp("비용")}>비용</TH>
                  <TH right w={colWidths["조회수"]} onResize={e => startResize("조회수", e)} {...sp("조회수")}>조회수</TH>
                  <TH right w={colWidths["조회당비용"]} onResize={e => startResize("조회당비용", e)}>조회당비용</TH>
                  <TH right w={colWidths["도달수"]} onResize={e => startResize("도달수", e)} {...sp("도달수")}>도달수</TH>
                  <TH right w={colWidths["도달당비용"]} onResize={e => startResize("도달당비용", e)}>도달당비용</TH>
                  <TH className="text-center" w={colWidths["트렌드"]} onResize={e => startResize("트렌드", e)}>트렌드</TH>
                  <TH w={colWidths["특이사항"]} onResize={e => startResize("특이사항", e)}>특이사항</TH>
                  <TH w={colWidths["삭제"]}></TH>
                </tr>
              </thead>
              <tbody>
                {sortedPosts.map(post => {
                  const s = post.latest_stats;
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
                          if (s?.play_count == null || post.prev_stats == null) return <span className="text-gray-300">-</span>;
                          const delta = s.play_count - (post.prev_stats.play_count ?? 0);
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
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "channel_type", editCell.value); if (e.key === "Escape") setEditCell(null); }}
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
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "posted_at", editCell.value); if (e.key === "Escape") setEditCell(null); }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "posted_at", value: post.posted_at ?? "" })}
                            className="cursor-text hover:text-a-blue transition-colors">
                            {post.posted_at ?? "-"}
                          </span>
                        )}
                      </TD>
                      <td style={{ minWidth: colWidths["캡션"] }} className="px-3 py-3">
                        {editCell?.postId === post.id && editCell?.field === "content_summary" ? (
                          <textarea
                            autoFocus
                            rows={2}
                            value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "content_summary", editCell.value)}
                            onKeyDown={e => { if (e.key === "Escape") setEditCell(null); }}
                            className="text-xs w-full bg-transparent border-b border-a-blue outline-none py-0.5 resize-none text-a-ink"
                          />
                        ) : (
                          <span
                            onClick={() => setEditCell({ postId: post.id, field: "content_summary", value: post.content_summary ?? "" })}
                            className="text-xs cursor-text text-a-ink-muted hover:text-a-ink transition-colors line-clamp-2 block"
                          >
                            {post.content_summary || <span className="text-gray-300">-</span>}
                          </span>
                        )}
                      </td>
                      <TD w={colWidths["인플루언서"]}>
                        {editCell?.postId === post.id && editCell?.field === "account_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "account_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "account_name", editCell.value); if (e.key === "Escape") setEditCell(null); }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                            <button onClick={async () => {
                              window.open(post.url, "_blank");
                              try { await navigator.clipboard.writeText(post.url); toast("링크가 복사됐습니다.", "success"); } catch {}
                            }} className="font-medium hover:text-a-blue transition-colors text-left truncate min-w-0">{displayName}</button>
                            <button onClick={() => setEditCell({ postId: post.id, field: "account_name", value: displayName === "-" ? "" : displayName })}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="이름 수정">
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
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "product_name", editCell.value); if (e.key === "Escape") setEditCell(null); }}
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
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "project_name", editCell.value); if (e.key === "Escape") setEditCell(null); }}
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
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "cost", editCell.value); if (e.key === "Escape") setEditCell(null); }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          <span className="text-a-ink-muted hover:text-a-blue transition-colors">
                            {post.cost != null ? post.cost.toLocaleString() + "원" : <span className="text-gray-300">-</span>}
                          </span>
                        )}
                      </td>
                      <TD right muted w={colWidths["조회수"]}>{fmt(s?.play_count)}</TD>
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
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "reach_count", editCell.value); if (e.key === "Escape") setEditCell(null); }}
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
                            onKeyDown={e => { if (e.key === "Escape") setEditCell(null); }}
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
          <HelpSection title="표시 지표">
            <HelpItem label="조회수 —">영상 조회 횟수입니다. 릴스·숏폼에서 주요 지표입니다.</HelpItem>
            <HelpItem label="좋아요 / 댓글 —">게시물의 좋아요 수와 댓글 수입니다.</HelpItem>
            <HelpItem label="측정일 —">가장 최근 수집된 날짜입니다.</HelpItem>
          </HelpSection>
          <HelpSection title="자동 수집">
            <p className="text-a-ink-muted leading-relaxed">GitHub Actions에 의해 매일 자동으로 수치를 수집합니다. 별도 실행 없이도 일별 데이터가 쌓입니다.</p>
          </HelpSection>
        </HelpModal>
      )}

      {/* 게시물 추가 모달 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[22px] p-6 w-96 shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-4">게시물 추가</h2>
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
            <p className="text-[11px] text-a-ink-muted mb-3">
              {(trendPost.all_stats ?? []).some(s => s.play_count != null) ? "조회수 트렌드" : "좋아요 트렌드"}
            </p>
            <LineChart
              data={(trendPost.all_stats ?? [])
                .filter(s => pickMetric(s) != null)
                .map(s => ({ date: s.measured_at, value: pickMetric(s)! }))}
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
