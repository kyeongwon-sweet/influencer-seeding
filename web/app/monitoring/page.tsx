"use client";
import { useEffect, useMemo, useState } from "react";
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
  created_at: string;
  influencers: { id: string; name: string; platform: string; post_type: string | null } | null;
  latest_stats: DailyStats | null;
  prev_stats: DailyStats | null;
  all_stats: DailyStats[];
};

type CsvRow = { url: string; project_name: string | null; product_name: string | null; channel_type: string | null };

type Filters = { name: string; project: string; product: string; type: string; channelType: string; dateFrom: string; dateTo: string };
const INIT_FILTERS: Filters = { name: "", project: "", product: "", type: "all", channelType: "all", dateFrom: "", dateTo: "" };
type EditCell = { postId: string; field: "project_name" | "product_name" | "channel_type" | "cost" | "reach_count"; value: string };
const POST_TYPES = ["릴스", "피드", "숏폼", "롱폼"];
const CHANNEL_TYPES = ["파워채널", "매거진", "먹스타", "인플루언서", "바이럴"];

function fmt(v: number | null | undefined) {
  return v == null ? "-" : v.toLocaleString();
}

function getPostType(url: string): string {
  if (url.includes("instagram.com")) return url.includes("/reel/") ? "릴스" : "피드";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return url.includes("/shorts/") ? "숏폼" : "롱폼";
  return "-";
}

// Sticky columns need explicit fixed widths so left offsets exactly match rendered widths.
// Widths: 인플루언서(180) + 프로젝트명(150) + 상품명(150) + 유형(72) + 게시물(220) + 게시일(104) = 876px
const STICKY_WIDTHS: Record<string, number> = {
  "인플루언서": 180, "프로젝트명": 150, "상품명": 150, "유형": 72, "게시물": 220, "게시일": 104,
};
const STICKY_LEFTS: Record<string, number> = {
  "인플루언서": 0, "프로젝트명": 180, "상품명": 330, "유형": 480, "게시물": 552, "게시일": 772,
};

function TH({ children, right, col, onSort, sorted, className: cls }: {
  children?: React.ReactNode; right?: boolean; col?: string;
  onSort?: () => void; sorted?: "asc" | "desc" | null; className?: string;
}) {
  const isSticky = col !== undefined;
  const isLast = col === "게시일";
  const sortable = onSort !== undefined;
  return (
    <th
      onClick={onSort}
      style={isSticky ? { width: STICKY_WIDTHS[col], minWidth: STICKY_WIDTHS[col], maxWidth: STICKY_WIDTHS[col], left: STICKY_LEFTS[col] } : undefined}
      className={[
        "px-3 py-3 text-xs font-medium whitespace-nowrap overflow-hidden",
        right ? "text-right" : "text-left",
        sortable ? `cursor-pointer select-none transition-colors ${sorted ? "text-a-ink" : "text-a-ink-muted hover:text-a-ink"}` : "text-a-ink-muted",
        isSticky ? "sticky z-40 bg-white" : "bg-white",
        isLast ? "shadow-[2px_0_5px_rgba(0,0,0,0.06)]" : "",
        cls ?? "",
      ].join(" ")}
    >
      {children}
      {sortable && <span className={`ml-1 ${sorted ? "text-a-blue" : "opacity-20"}`}>{sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : "↕"}</span>}
    </th>
  );
}

function TD({ children, right, muted, col }: { children: React.ReactNode; right?: boolean; muted?: boolean; col?: string }) {
  const isSticky = col !== undefined;
  const isLast = col === "게시일";
  return (
    <td
      style={isSticky ? { width: STICKY_WIDTHS[col], minWidth: STICKY_WIDTHS[col], maxWidth: STICKY_WIDTHS[col], left: STICKY_LEFTS[col] } : undefined}
      className={[
        "px-3 py-4 text-xs tabular-nums whitespace-nowrap overflow-hidden",
        right ? "text-right" : "text-left",
        muted ? "text-a-ink-muted" : "text-a-ink",
        isSticky ? "sticky z-10 bg-white group-hover:bg-a-parchment" : "",
        isLast ? "shadow-[2px_0_5px_rgba(0,0,0,0.06)]" : "",
      ].join(" ")}
    >
      {children}
    </td>
  );
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

  const filteredPosts = posts.filter(post => {
    const displayName = (post.account_name ?? post.influencers?.name ?? "").toLowerCase();
    if (filters.name && !displayName.includes(filters.name.toLowerCase())) return false;
    if (filters.project && !(post.project_name ?? "").toLowerCase().includes(filters.project.toLowerCase())) return false;
    if (filters.product && !(post.product_name ?? "").toLowerCase().includes(filters.product.toLowerCase())) return false;
    if (filters.type !== "all" && getPostType(post.url) !== filters.type) return false;
    if (filters.channelType !== "all" && post.channel_type !== filters.channelType) return false;
    if (filters.dateFrom && (!post.posted_at || post.posted_at < filters.dateFrom)) return false;
    if (filters.dateTo && (!post.posted_at || post.posted_at > filters.dateTo)) return false;
    return true;
  });

  const hasFilter = filters.name !== "" || filters.project !== "" || filters.product !== "" || filters.type !== "all" || filters.channelType !== "all" || filters.dateFrom !== "" || filters.dateTo !== "";
  const colSpan = 15;

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

  useEffect(() => {
    loadPosts().finally(() => setLoading(false));
  }, []);

  async function loadPosts() {
    const res = await fetch("/api/sponsored-posts");
    const json = await res.json();
    if (!res.ok) return;
    setPosts(Array.isArray(json) ? json : []);
  }

  async function runMonitoring() {
    setRunning(true);
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "monitoring", payload: {} }),
    });
    setRunning(false);
    toast("모니터링 수집이 시작됐습니다. 완료 후 새로고침 버튼을 눌러주세요.", "info");
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
    await fetch("/api/sponsored-posts", {
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
    setForm({ url: "", product_name: "", project_name: "", channel_type: "", cost: "" });
    setShowAdd(false);
    setAdding(false);
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
        return { project_name: cols[0] || null, product_name: cols[1] || null, channel_type: cols[2] || null, url: cols[3] ?? "" };
      }).filter(r => r.url);
      setCsvRows(rows);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  function downloadTemplate() {
    const csv = "프로젝트명,상품명,채널분류,게시물URL\n예시프로젝트,예시상품,인플루언서,https://www.instagram.com/p/xxxxx/";
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
    setUploading(false);
    if (!res.ok) { toast("업로드 중 오류가 발생했습니다.", "error"); return; }
    const count = csvRows.length;
    setCsvRows([]);
    setShowUpload(false);
    await loadPosts();
    toast(`${count}개 게시물이 추가됐습니다.`, "success");
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
      case "채널분류": av = (a.channel_type ?? "").toLowerCase(); bv = (b.channel_type ?? "").toLowerCase(); break;
      case "유형": av = getPostType(a.url); bv = getPostType(b.url); break;
      case "게시일": av = a.posted_at ?? ""; bv = b.posted_at ?? ""; break;
      case "조회수": av = sa?.play_count ?? -1; bv = sb?.play_count ?? -1; break;
      case "도달수": av = a.reach_count ?? -1; bv = b.reach_count ?? -1; break;
      case "비용": av = a.cost ?? -1; bv = b.cost ?? -1; break;
      case "측정일": av = sa?.measured_at ?? ""; bv = sb?.measured_at ?? ""; break;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const sp = (col: string) => ({
    onSort: () => handleSort(col),
    sorted: (sortCol === col ? sortDir : null) as "asc" | "desc" | null,
  });

  function downloadCSV() {
    const headers = ["인플루언서", "프로젝트명", "상품명", "채널분류", "유형", "게시물 URL", "게시일", "조회수", "도달수", "비용", "조회당비용", "도달당비용", "측정일"];
    const rows = sortedPosts.map(post => {
      const s = post.latest_stats;
      const play = s?.play_count ?? null;
      const reach = post.reach_count ?? null;
      const cost = post.cost ?? null;
      const cpr = cost != null && play != null && play > 0 ? Math.round(cost / play) : "";
      const cpreach = cost != null && reach != null && reach > 0 ? Math.round(cost / reach) : "";
      return [
        post.account_name ?? post.influencers?.name ?? "",
        post.project_name ?? "",
        post.product_name ?? "",
        post.channel_type ?? "",
        getPostType(post.url),
        post.url,
        post.posted_at ?? "",
        play ?? "",
        reach ?? "",
        cost ?? "",
        cpr,
        cpreach,
        s?.measured_at ?? "",
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

  return (
    <div className="min-h-screen bg-a-parchment">
      <header className="bg-black h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-white/50 hover:text-white transition text-sm">←</Link>
          <span className="text-white text-sm font-medium tracking-tight">협찬 모니터링</span>
          <span className="text-white/40 text-xs">
            {hasFilter ? `${filteredPosts.length} / ${posts.length}건` : `${posts.length}건`}
          </span>
        </div>
      </header>

      <div className="sticky top-11 z-[35] bg-white border-b border-a-hairline px-6 h-11 flex items-center justify-between">
        <button onClick={() => setShowHelp(true)}
          className="flex items-center gap-1.5 text-xs text-a-ink-muted hover:text-a-ink transition">
          <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
            <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5"/>
            <path d="M10 9.5v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <circle cx="10" cy="6.5" r="1" fill="currentColor"/>
          </svg>
          사용 안내
        </button>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowUpload(true)} className="btn-secondary">CSV 업로드</button>
          <button onClick={() => setShowAdd(true)} className="btn-secondary">+ 게시물 추가</button>
          <button onClick={refresh} disabled={loading} className="btn-secondary">새로고침</button>
          <button onClick={runMonitoring} disabled={running} className="btn-primary">
            {running ? "실행 중..." : "지금 수집"}
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
          <input
            type="text"
            placeholder="상품명"
            value={filters.product}
            onChange={e => setFilters(p => ({ ...p, product: e.target.value }))}
            className={`filter-input w-24 ${filters.product ? "border-a-blue" : ""}`}
          />
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
          <button onClick={downloadCSV} disabled={filteredPosts.length === 0} className="btn-secondary">
            엑셀 다운로드
          </button>
        </div>

        {filteredPosts.length > 0 && (
          <div className="bg-white rounded-[18px] border border-a-hairline p-5 mb-4">
            <div className="flex items-center gap-6 mb-5 pb-4 border-b border-a-hairline">
              <div>
                <p className="text-[11px] text-a-ink-muted mb-0.5">조회수 합계</p>
                <p className="text-2xl font-bold tabular-nums tracking-tight font-numeric">{totalPlayCount.toLocaleString()}</p>
              </div>
              <div className="w-px h-8 bg-a-hairline" />
              <div>
                <p className="text-[11px] text-a-ink-muted mb-0.5">좋아요 합계</p>
                <p className="text-lg font-bold tabular-nums tracking-tight font-numeric">{totalLikes.toLocaleString()}</p>
              </div>
              <div className="w-px h-8 bg-a-hairline" />
              <div>
                <p className="text-[11px] text-a-ink-muted mb-0.5">댓글 합계</p>
                <p className="text-lg font-bold tabular-nums tracking-tight font-numeric">{totalComments.toLocaleString()}</p>
              </div>
            </div>
            <div className="grid gap-6" style={{ gridTemplateColumns: "3fr 2fr" }}>
              <div className="flex flex-col">
                <p className="text-[11px] text-a-ink-muted mb-2">조회수 트렌드 (누적)</p>
                <LineChart data={chartData} height={130} gradId="summaryGrad" />
              </div>
              <div className="flex flex-col">
                <p className="text-[11px] text-a-ink-muted mb-2">일자별 조회수 증감</p>
                {deltaTableData.length === 0 ? (
                  <div className="flex items-center justify-center h-[130px] text-xs text-a-ink-muted">측정 데이터 2일 이상 필요</div>
                ) : (
                  <div className="flex-1 min-h-0 overflow-y-auto rounded-[8px] border border-a-hairline">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-a-parchment/80 backdrop-blur-sm">
                        <tr className="border-b border-a-hairline">
                          <th className="px-2 py-1.5 text-left font-medium text-gray-400 uppercase tracking-wider">날짜</th>
                          <th className="px-2 py-1.5 text-right font-medium text-gray-400 uppercase tracking-wider">조회수</th>
                          <th className="px-2 py-1.5 text-right font-medium text-gray-400 uppercase tracking-wider">좋아요</th>
                          <th className="px-2 py-1.5 text-right font-medium text-gray-400 uppercase tracking-wider">댓글</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[{ date: dailyTotals[0].date, play: 0, likes: 0, comments: 0 }, ...deltaTableData].map((d, i) => {
                          function deltaCell(v: number) {
                            const pos = v > 0, neg = v < 0;
                            return (
                              <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${pos ? "text-red-500" : neg ? "text-emerald-600" : "text-gray-300"}`}>
                                {pos ? "+" : ""}{v.toLocaleString()}
                              </td>
                            );
                          }
                          return (
                            <tr key={i} className="border-b border-a-divider last:border-0">
                              <td className="px-2 py-1.5 text-a-ink-muted tabular-nums">
                                {d.date.slice(5).replace("-", "/")}
                              </td>
                              {deltaCell(d.play)}
                              {deltaCell(d.likes)}
                              {deltaCell(d.comments)}
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

        <div className="bg-white rounded-[18px] border border-a-hairline">
          <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-a-ink-muted text-sm">로딩 중...</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-30">
                <tr className="border-b border-a-hairline">
                  <TH col="인플루언서" {...sp("인플루언서")}>인플루언서</TH>
                  <TH col="프로젝트명" {...sp("프로젝트명")}>프로젝트명</TH>
                  <TH col="상품명" {...sp("상품명")}>상품명</TH>
                  <TH col="유형" {...sp("유형")}>유형</TH>
                  <TH col="게시물">게시물</TH>
                  <TH col="게시일" {...sp("게시일")}>게시일</TH>
                  <TH {...sp("채널분류")} className="min-w-[90px]">채널분류</TH>
                  <TH right {...sp("조회수")} className="min-w-[100px]">조회수</TH>
                  <TH right {...sp("도달수")} className="min-w-[100px]">도달수</TH>
                  <TH right {...sp("비용")} className="min-w-[100px]">비용</TH>
                  <TH right className="min-w-[100px]">조회당비용</TH>
                  <TH right className="min-w-[100px]">도달당비용</TH>
                  <TH {...sp("측정일")} className="min-w-[110px]">측정일</TH>
                  <TH className="min-w-[90px] text-center">Trend</TH>
                  <TH className="min-w-[60px]"></TH>
                </tr>
              </thead>
              <tbody>
                {sortedPosts.map(post => {
                  const s = post.latest_stats;
                  const displayName = post.account_name ?? post.influencers?.name ?? "-";
                  return (
                    <tr key={post.id} className="group border-b border-a-divider last:border-0 hover:bg-a-parchment/60 transition-colors">
                      <TD col="인플루언서"><span className="font-medium">{displayName}</span></TD>
                      <TD col="프로젝트명">
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
                      <TD col="상품명">
                        {editCell?.postId === post.id && editCell?.field === "product_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "product_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "product_name", editCell.value); if (e.key === "Escape") setEditCell(null); }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <span onClick={() => setEditCell({ postId: post.id, field: "product_name", value: post.product_name ?? "" })}
                            className="cursor-text text-a-ink-muted hover:text-a-blue transition-colors">
                            {post.product_name ?? "-"}
                          </span>
                        )}
                      </TD>
                      <TD col="유형" muted>{getPostType(post.url)}</TD>
                      <TD col="게시물">
                        <a href={post.url} target="_blank" rel="noreferrer"
                          className="text-a-blue hover:underline max-w-[120px] block truncate">
                          {post.url.replace(/^https?:\/\/(www\.)?/, "")}
                        </a>
                      </TD>
                      <TD col="게시일" muted>{post.posted_at ?? "-"}</TD>
                      <TD muted>
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
                      <TD right>{fmt(s?.play_count)}</TD>
                      <td className="px-3 py-4 text-xs tabular-nums text-right whitespace-nowrap min-w-[100px] cursor-text"
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
                      <td className="px-3 py-4 text-xs tabular-nums text-right whitespace-nowrap min-w-[100px] cursor-text"
                        onClick={() => editCell?.postId !== post.id && setEditCell({ postId: post.id, field: "cost", value: String(post.cost ?? "") })}>
                        {editCell?.postId === post.id && editCell?.field === "cost" ? (
                          <input autoFocus type="number" value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchPost(post.id, "cost", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchPost(post.id, "cost", editCell.value); if (e.key === "Escape") setEditCell(null); }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          <span className="text-a-ink-muted hover:text-a-blue transition-colors">
                            {post.cost != null ? post.cost.toLocaleString() : <span className="text-gray-300">-</span>}
                          </span>
                        )}
                      </td>
                      <TD right muted>
                        {post.cost != null && s?.play_count != null && s.play_count > 0
                          ? Math.round(post.cost / s.play_count).toLocaleString()
                          : <span className="text-gray-300">-</span>}
                      </TD>
                      <TD right muted>
                        {post.cost != null && post.reach_count != null && post.reach_count > 0
                          ? Math.round(post.cost / post.reach_count).toLocaleString()
                          : <span className="text-gray-300">-</span>}
                      </TD>
                      <TD muted>{s?.measured_at ?? "-"}</TD>
                      <td className="px-3 py-3 text-center">
                        <Sparkline stats={post.all_stats ?? []} postId={post.id} onClick={() => setTrendPost(post)} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <button onClick={() => deletePost(post.id)}
                          className="text-a-ink-muted hover:text-red-500 text-xs transition">삭제</button>
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
          <div className="bg-white rounded-[22px] p-6 w-[480px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-1">CSV 일괄 업로드</h2>
            <p className="text-xs text-a-ink-muted mb-4">컬럼 순서: 프로젝트명, 상품명, 채널분류, 게시물URL (헤더 행 필수)</p>
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
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} className="border-b border-a-divider last:border-0">
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.project_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.product_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.channel_type ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-blue max-w-[160px] truncate">{r.url}</td>
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

      <ToastContainer toasts={toasts} />
    </div>
  );
}
