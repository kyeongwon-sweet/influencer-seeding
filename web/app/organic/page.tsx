"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";

const PLATFORMS = ["인스타그램", "유튜브", "블로그", "틱톡", "스레드"];

// DB에 영문으로 저장된 플랫폼값 → 한글 정규화
const PLATFORM_KO: Record<string, string> = {
  instagram: "인스타그램",
  youtube: "유튜브",
  blog: "블로그",
  tiktok: "틱톡",
  threads: "스레드",
};
function normPlatform(p: string): string {
  return PLATFORM_KO[p.toLowerCase()] ?? p;
}

type Mention = {
  id: string;
  url: string;
  account_name: string | null;
  platform: string;
  content_summary: string | null;
  mentioned_product: string | null;
  uploaded_at: string | null;
  view_count: number | null;
  exposure_type: string | null;
  notes: string | null;
  created_at: string;
};

type Filters = { name: string; platform: string; products: string[]; exposureType: string; dateFrom: string; dateTo: string };
const INIT_FILTERS: Filters = { name: "", platform: "all", products: [], exposureType: "all", dateFrom: "", dateTo: "" };

type CsvRow = {
  platform: string; url: string; account_name: string | null;
  content_summary: string | null; mentioned_product: string | null;
  uploaded_at: string | null; view_count: number | null;
};

// [사용자이름, 플랫폼, 캡션, 언급제품, 업로드일, 조회수, 유형, 특이사항]
const INIT_COL_WIDTHS = [180, 90, 300, 160, 100, 90, 90, 160];

function getThumbnailUrl(url: string): string | null {
  let m = url.match(/youtube\.com\/shorts\/([^/?&#]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  m = url.match(/[?&]v=([^&]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  m = url.match(/youtu\.be\/([^/?#]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  return null;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(d: string | null): string {
  if (!d) return "-";
  return d.slice(0, 10).replace(/-/g, ".");
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${s % 60}초`;
}

export default function OrganicPage() {
  const { toasts, show: toast } = useToast();
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [filters, setFilters] = useState<Filters>(INIT_FILTERS);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [colWidths, setColWidths] = useState<number[]>(INIT_COL_WIDTHS);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ url: "", account_name: "", platform: "인스타그램", content_summary: "", mentioned_product: "", uploaded_at: "", view_count: "" });
  const [adding, setAdding] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [editCell, setEditCell] = useState<{ id: string; field: "mentioned_product" | "exposure_type" | "account_name" | "content_summary" | "uploaded_at" | "view_count" | "notes"; value: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [importingNotion, setImportingNotion] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showTimeoutError, setShowTimeoutError] = useState(false);
  const resizingRef = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);
  const runningJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadMentions().finally(() => setLoading(false));
    checkAndResumeJob();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  async function loadMentions() {
    const res = await fetch("/api/organic-mentions");
    const data = await res.json();
    if (Array.isArray(data)) setMentions(data);
  }

  async function checkAndResumeJob() {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) return;
      const jobs: { id: string; type: string; status: string }[] = await res.json();
      const inProgress = jobs.find(j => j.type === "organic" && j.status === "running");
      if (!inProgress) return;
      runningJobIdRef.current = inProgress.id;
      setRunning(true);
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
      startPolling(Date.now());
    } catch { /* 무시 */ }
  }

  function startPolling(startTime: number) {
    pollTimerRef.current = setInterval(async () => {
      if (Date.now() - startTime >= 300_000) {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null;
        elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        setShowTimeoutError(true);
        return;
      }
      await checkJob();
    }, 10_000);
  }

  async function checkJob() {
    try {
      const res = await fetch("/api/jobs");
      const jobs: { id: string; status: string; payload?: { added?: number }; error?: string }[] = await res.json();
      const cur = jobs.find(j => j.id === runningJobIdRef.current);
      if (cur?.status === "done") {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null;
        elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        await loadMentions();
        toast(`수집 완료! ${cur.payload?.added ?? 0}건 추가됐습니다.`, "success");
      } else if (cur?.status === "failed") {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null;
        elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        toast(`수집 실패: ${cur.error ?? "알 수 없는 오류"}`, "error");
      }
    } catch { /* 폴링 오류 무시 */ }
  }

  async function runCollection() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setRunning(true);
    setShowTimeoutError(false);
    setElapsedSeconds(0);

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "organic", payload: {} }),
    });

    if (!res.ok) {
      setRunning(false);
      const errBody = await res.json().catch(() => null);
      toast(`수집 실행 실패 (${res.status}): ${errBody?.error ?? "알 수 없는 오류"}`, "error");
      return;
    }

    const { job } = await res.json();
    runningJobIdRef.current = job.id;
    toast("무상 노출 수집이 시작됐습니다. 완료 시 자동으로 업데이트됩니다.", "info");
    elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
    startPolling(Date.now());

    // 기존 게시글 조회수 백그라운드 갱신 (fire-and-forget)
    fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "organic_refresh", payload: {} }),
    }).catch(() => {});
  }

  async function addMention() {
    if (!addForm.url) return;
    setAdding(true);
    const res = await fetch("/api/organic-mentions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: addForm.url,
        account_name: addForm.account_name || null,
        platform: addForm.platform,
        content_summary: addForm.content_summary || null,
        mentioned_product: addForm.mentioned_product || null,
        uploaded_at: addForm.uploaded_at || null,
        view_count: addForm.view_count ? Number(addForm.view_count) : null,
        source: "manual",
      }),
    });
    setAdding(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast(`추가 실패: ${(err as { error?: string }).error ?? "오류가 발생했습니다."}`, "error");
      return;
    }
    setAddForm({ url: "", account_name: "", platform: "인스타그램", content_summary: "", mentioned_product: "", uploaded_at: "", view_count: "" });
    setShowAdd(false);
    await loadMentions();
    toast("게시물이 추가됐습니다.", "success");
  }

  async function deleteMention(id: string) {
    if (!confirm("게시물을 삭제하시겠습니까?")) return;
    await fetch(`/api/organic-mentions/${id}`, { method: "DELETE" });
    setMentions(prev => prev.filter(m => m.id !== id));
  }

  async function patchProduct(id: string, value: string) {
    await patchMentionField(id, "mentioned_product", value);
  }

  async function patchMentionField(id: string, field: string, value: string) {
    const isNumeric = field === "view_count";
    const parsed = isNumeric ? (value === "" ? null : Number(value)) : (value || null);
    const res = await fetch(`/api/organic-mentions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: parsed }),
    });
    if (res.ok) {
      setMentions(prev => prev.map(m => m.id === id ? { ...m, [field]: parsed } : m));
    } else {
      toast("저장에 실패했습니다.", "error");
    }
    setEditCell(null);
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
          platform: cols[0] || "인스타그램",
          url: cols[1] ?? "",
          account_name: cols[2] || null,
          content_summary: cols[3] || null,
          mentioned_product: cols[4] || null,
          uploaded_at: cols[5] || null,
          view_count: cols[6] ? Number(cols[6]) : null,
        };
      }).filter(r => r.url);
      setCsvRows(rows);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  function downloadTemplate() {
    const csv = "플랫폼,URL,계정명,캡션,언급제품,업로드일,조회수\n인스타그램,https://www.instagram.com/p/xxxxx/,계정명,라라스윗 언급 내용,라라스윗 아이스크림,2024-01-01,10000";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "무상노출_업로드_템플릿.csv";
    a.click();
  }

  async function importFromNotion() {
    setImportingNotion(true);
    try {
      const res = await fetch("/api/organic-mentions/import-notion", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error ?? "노션 불러오기에 실패했습니다.", "error");
      } else {
        await loadMentions();
        if (data.added > 0) {
          toast(`노션에서 ${data.added}건 추가됐습니다.`, "success");
        } else {
          toast(`노션 DB 조회 완료 (${data.total ?? 0}건) — 새로운 게시물이 없습니다.`, "info");
        }
      }
    } catch {
      toast("노션 불러오기 중 오류가 발생했습니다.", "error");
    }
    setImportingNotion(false);
  }

  async function uploadCsvRows() {
    if (csvRows.length === 0) return;
    setUploading(true);
    const payload = csvRows.map(r => ({ ...r, source: "csv" }));
    const res = await fetch("/api/organic-mentions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setUploading(false);
    if (!res.ok) { toast("업로드 중 오류가 발생했습니다.", "error"); return; }
    const count = csvRows.length;
    setCsvRows([]);
    setShowUpload(false);
    await loadMentions();
    toast(`${count}개 게시물이 추가됐습니다.`, "success");
  }

  function downloadCSV() {
    const headers = ["계정명", "플랫폼", "URL", "캡션", "언급제품", "업로드일", "조회수"];
    const rows = sorted.map(m => [
      m.account_name ?? "",
      normPlatform(m.platform),
      m.url,
      m.content_summary ?? "",
      m.mentioned_product ?? "",
      m.uploaded_at ?? "",
      m.view_count ?? "",
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `무상노출_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function startResize(e: React.MouseEvent, colIdx: number) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { colIdx, startX: e.clientX, startW: colWidths[colIdx] };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const newW = Math.max(50, resizingRef.current.startW + ev.clientX - resizingRef.current.startX);
      setColWidths(prev => { const next = [...prev]; next[resizingRef.current!.colIdx] = newW; return next; });
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleSort(col: string) {
    setSortDir(prev => sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  }

  const filtered = mentions.filter(m => {
    // (광고) 또는 #광고 패턴만 제외 (내돈내산 있으면 통과)
    const cap = (m.content_summary ?? '').toLowerCase();
    if (!cap.includes('내돈내산') && (cap.includes('(광고)') || cap.includes('#광고'))) return false;

    if (filters.name && !(m.account_name ?? "").toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.platform !== "all" && normPlatform(m.platform) !== filters.platform) return false;
    if (filters.products.length > 0) {
      // 콤마로 구분된 복수 제품 지원: 선택된 제품 중 하나라도 포함되면 통과
      const mentionProds = (m.mentioned_product ?? "").split(",").map(p => p.trim()).filter(Boolean);
      if (!filters.products.some(fp => mentionProds.includes(fp))) return false;
    }
    if (filters.exposureType !== "all" && m.exposure_type !== filters.exposureType) return false;
    if (filters.dateFrom && (!m.uploaded_at || m.uploaded_at < filters.dateFrom)) return false;
    if (filters.dateTo && (!m.uploaded_at || m.uploaded_at > filters.dateTo)) return false;
    return true;
  });

  const hasFilter = filters.name !== "" || filters.platform !== "all" || filters.products.length > 0 || filters.exposureType !== "all" || filters.dateFrom !== "" || filters.dateTo !== "";

  // 언급 제품 옵션 — 콤마 구분 복수 값 파싱
  const productOptions = Array.from(
    new Set(
      mentions.flatMap(m =>
        m.mentioned_product
          ? m.mentioned_product.split(",").map(p => p.trim()).filter(Boolean)
          : []
      )
    )
  ).sort();

  // 최근 업데이트 시간
  const lastUpdatedAt = mentions.length > 0
    ? mentions.reduce((a, b) => a.created_at > b.created_at ? a : b).created_at
    : null;

  const sorted = [...filtered].sort((a, b) => {
    if (!sortCol) return 0;
    let av: string | number = "", bv: string | number = "";
    switch (sortCol) {
      case "사용자이름": av = (a.account_name ?? "").toLowerCase(); bv = (b.account_name ?? "").toLowerCase(); break;
      case "플랫폼": av = a.platform; bv = b.platform; break;
      case "언급제품": av = (a.mentioned_product ?? "").toLowerCase(); bv = (b.mentioned_product ?? "").toLowerCase(); break;
      case "업로드일": av = a.uploaded_at ?? ""; bv = b.uploaded_at ?? ""; break;
      case "조회수": av = a.view_count ?? -1; bv = b.view_count ?? -1; break;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  function rsTH(col: string, colIdx: number, sortable = true, right = false) {
    const active = sortCol === col;
    return (
      <th
        key={col}
        style={{ minWidth: colWidths[colIdx] }}
        className={`relative px-4 py-3 ${right ? "text-right" : "text-left"} text-[10px] font-medium uppercase tracking-wider whitespace-nowrap bg-white select-none ${
          sortable ? (active ? "text-a-ink" : "text-gray-400") : "text-gray-400"
        }`}
      >
        {sortable ? (
          <span onClick={() => handleSort(col)} className="cursor-pointer hover:text-gray-600 transition-colors">
            {col}
            <span className={`ml-1 ${active ? "text-a-blue" : "opacity-20"}`}>
              {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
            </span>
          </span>
        ) : col}
        <div onMouseDown={e => startResize(e, colIdx)} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-100 z-10" />
      </th>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-a-ink transition text-sm">←</Link>
          <span className="text-a-ink text-sm font-semibold tracking-tight">무상 노출</span>
          {mentions.length > 0 && (
            <span className="text-gray-400 text-xs">
              {hasFilter && filtered.length !== mentions.length
                ? `${filtered.length} / ${mentions.length}건`
                : `${mentions.length}건`}
            </span>
          )}
        </div>
        {lastUpdatedAt && (
          <span className="text-xs text-a-ink-muted">
            마지막 업데이트 <span className="font-medium text-a-ink">{formatTimestamp(lastUpdatedAt)}</span>
          </span>
        )}
      </header>

      <div className="sticky top-14 z-[35] bg-white border-b border-a-hairline px-6 h-11 flex items-center justify-between">
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
          <button onClick={importFromNotion} disabled={importingNotion} className="btn-secondary">
            {importingNotion ? "불러오는 중..." : "노션 불러오기"}
          </button>
          <button onClick={() => setShowUpload(true)} className="btn-secondary">CSV 업로드</button>
          <button onClick={() => setShowAdd(true)} className="btn-secondary">+ 게시물 추가</button>
          {running && (
            <>
              <span className="text-xs text-a-ink-muted tabular-nums">{formatElapsed(elapsedSeconds)}</span>
              <button onClick={checkJob} className="btn-secondary">지금 확인</button>
            </>
          )}
          <button onClick={runCollection} disabled={running} className="btn-primary">
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

      {/* 무상 노출 가이드 */}
      <div className="mx-6 mt-5 mb-4 bg-white border border-gray-200 rounded-lg px-5 py-4 shadow-sm">
        <p className="text-sm font-bold text-a-ink mb-4">📌 무상 노출 수집 기준</p>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-[13px] font-semibold text-a-ink mb-2">✓ 수집 대상:</p>
            <ul className="text-[13px] text-a-ink-muted space-y-1 list-none leading-relaxed">
              <li>• 아이돌/연예인</li>
              <li>• 50만+ 인플루언서</li>
              <li>• 50만+ 뷰</li>
              <li>• 시딩 건</li>
            </ul>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-a-ink mb-2">💬 댓글 작성:</p>
            <ul className="text-[13px] text-a-ink-muted space-y-1 list-none leading-relaxed">
              <li>• 감사댓글</li>
              <li>• 공개 샤라웃</li>
              <li>• 주력층만 반응</li>
              <li>• 빠른 댓글</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="px-6 py-6">
        {/* 필터 바 */}
        <div className="bg-white rounded-[14px] border border-a-hairline px-4 py-2.5 mb-3 flex items-center gap-2 flex-wrap">
          <input
            type="text"
            placeholder="계정명 검색"
            value={filters.name}
            onChange={e => setFilters(p => ({ ...p, name: e.target.value }))}
            className={`filter-input w-32 ${filters.name ? "border-a-blue" : ""}`}
          />
          <select
            value={filters.platform}
            onChange={e => setFilters(p => ({ ...p, platform: e.target.value }))}
            className={`filter-select ${filters.platform !== "all" ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
          >
            <option value="all">전체 플랫폼</option>
            {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {/* 유형 필터 드롭다운 */}
          <select value={filters.exposureType}
            onChange={e => setFilters(p => ({ ...p, exposureType: e.target.value }))}
            className={`filter-select ${filters.exposureType !== "all" ? "border-a-blue text-a-blue bg-blue-50" : ""}`}>
            <option value="all">전체 유형</option>
            <option value="무가시딩">무가시딩</option>
            <option value="오가닉">오가닉 노출</option>
          </select>
          {/* 언급 제품 다중 선택 칩 */}
          {productOptions.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap scrollbar-none pb-0.5">
              {productOptions.map(p => {
                const active = filters.products.includes(p);
                return (
                  <button key={p}
                    onClick={() => setFilters(prev => ({
                      ...prev,
                      products: active
                        ? prev.products.filter(x => x !== p)
                        : [...prev.products, p],
                    }))}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      active
                        ? "border-a-blue bg-blue-50 text-a-blue font-medium"
                        : "border-a-hairline text-a-ink-muted hover:border-gray-400"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          )}
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
            <button onClick={() => setFilters(INIT_FILTERS)} className="btn-ghost py-1">초기화</button>
          )}
          <button onClick={downloadCSV} disabled={filtered.length === 0} className="btn-secondary">
            엑셀 다운로드
          </button>
        </div>

        {/* 테이블 */}
        <div className="bg-white rounded-[18px] border border-a-hairline overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="p-8 text-center text-a-ink-muted text-sm">로딩 중...</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-30">
                  <tr className="border-b border-a-hairline">
                    <th className="px-2 py-3 bg-white w-16 text-[10px] font-medium text-gray-400 uppercase tracking-wider"></th>
                    {rsTH("사용자이름", 0)}
                    {rsTH("플랫폼", 1)}
                    {rsTH("캡션", 2, false)}
                    {rsTH("언급제품", 3)}
                    {rsTH("업로드일", 4)}
                    {rsTH("조회수", 5, true, true)}
                    {rsTH("유형", 6, false)}
                    {rsTH("특이사항", 7, false)}
                    <th className="px-4 py-3 bg-white w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(m => {
                    const thumb = getThumbnailUrl(m.url);
                    const pKo = normPlatform(m.platform);
                    const platformShort = pKo === "인스타그램" ? "IG" : pKo === "유튜브" ? "YT" : pKo === "블로그" ? "BL" : pKo.slice(0, 2);
                    return (
                    <tr key={m.id} className="group border-b border-a-divider last:border-0 hover:bg-a-parchment/60 transition-colors">
                      {/* 썸네일 */}
                      <td className="px-2 py-2 w-16">
                        <a href={m.url} target="_blank" rel="noreferrer" className="block hover:opacity-80 transition-opacity">
                          {thumb
                            ? <img src={thumb} alt="" className="w-12 h-9 object-cover rounded" />
                            : <div className="w-12 h-9 bg-a-parchment rounded flex items-center justify-center text-[10px] text-a-ink-muted font-medium">{platformShort}</div>
                          }
                        </a>
                      </td>
                      <td style={{ minWidth: colWidths[0], width: colWidths[0] }} className="px-4 py-4 whitespace-nowrap overflow-hidden">
                        {editCell?.id === m.id && editCell.field === "account_name" ? (
                          <input autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchMentionField(m.id, "account_name", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchMentionField(m.id, "account_name", editCell.value); if (e.key === "Escape") setEditCell(null); }}
                            className="w-full text-sm font-medium bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <a href={m.url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 font-medium hover:text-a-blue transition-colors group/link">
                              {m.account_name ?? <span className="text-a-ink-muted text-xs">링크</span>}
                              <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="opacity-0 group-hover/link:opacity-50 flex-shrink-0 transition-opacity">
                                <path d="M5.5 2.5H2.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M8.5 1.5h4m0 0v4m0-4L6 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </a>
                            <button onClick={() => setEditCell({ id: m.id, field: "account_name", value: m.account_name ?? "" })}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="이름 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths[1] }} className="px-4 py-4 text-xs text-a-ink-muted whitespace-nowrap">
                        {pKo}
                      </td>
                      <td style={{ minWidth: colWidths[2] }} className="px-4 py-4 text-xs text-a-ink-muted max-w-[320px]">
                        {editCell?.id === m.id && editCell.field === "content_summary" ? (
                          <textarea autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchMentionField(m.id, "content_summary", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); patchMentionField(m.id, "content_summary", editCell.value); } if (e.key === "Escape") setEditCell(null); }}
                            rows={2}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 resize-none leading-relaxed" />
                        ) : (
                          <div className="flex items-start gap-1">
                            <span className="line-clamp-2 leading-relaxed flex-1">{m.content_summary ?? "-"}</span>
                            <button onClick={() => setEditCell({ id: m.id, field: "content_summary", value: m.content_summary ?? "" })}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0 mt-0.5" title="내용 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths[3] }} className="px-4 py-4 whitespace-nowrap">
                        {editCell?.id === m.id && editCell.field === "mentioned_product" ? (
                          <div className="flex items-center gap-1">
                            <input
                              autoFocus
                              value={editCell.value}
                              onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                              onKeyDown={e => {
                                if (e.key === "Enter") patchProduct(m.id, editCell.value);
                                if (e.key === "Escape") setEditCell(null);
                              }}
                              placeholder="쉼표로 구분해 복수 입력"
                              className="flex-1 text-xs bg-transparent border-b border-a-blue outline-none py-0.5 min-w-0"
                            />
                            <button onClick={() => patchProduct(m.id, editCell.value)}
                              className="text-a-blue hover:text-a-blue-hover flex-shrink-0 transition" title="저장">
                              <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                                <path d="M4 10l5 5 8-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            <button onClick={() => setEditCell(null)}
                              className="text-a-ink-muted hover:text-a-ink flex-shrink-0 transition" title="취소">
                              <svg width="10" height="10" viewBox="0 0 20 20" fill="none">
                                <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <span
                            onClick={() => setEditCell({ id: m.id, field: "mentioned_product", value: m.mentioned_product ?? "" })}
                            className="flex flex-wrap gap-1 cursor-text">
                            {m.mentioned_product
                              ? m.mentioned_product.split(",").map(p => p.trim()).filter(Boolean).map(p => (
                                  <span key={p} className="text-xs bg-a-parchment px-2 py-0.5 rounded-full text-a-ink hover:text-a-blue transition-colors">{p}</span>
                                ))
                              : <span className="text-xs text-gray-300">클릭해서 입력</span>}
                          </span>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths[4] }} className="px-4 py-4 text-xs text-a-ink-muted whitespace-nowrap">
                        {editCell?.id === m.id && editCell.field === "uploaded_at" ? (
                          <input autoFocus type="date" value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchMentionField(m.id, "uploaded_at", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchMentionField(m.id, "uploaded_at", editCell.value); if (e.key === "Escape") setEditCell(null); }}
                            className="text-xs bg-transparent border-b border-a-blue outline-none py-0.5" />
                        ) : (
                          <div className="flex items-center gap-1">
                            <span>{formatDate(m.uploaded_at)}</span>
                            <button onClick={() => setEditCell({ id: m.id, field: "uploaded_at", value: m.uploaded_at?.slice(0, 10) ?? "" })}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="업로드일 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                      <td style={{ minWidth: colWidths[5] }} className="px-4 py-4 text-xs text-right tabular-nums whitespace-nowrap text-a-ink">
                        {editCell?.id === m.id && editCell.field === "view_count" ? (
                          <input autoFocus type="number" value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchMentionField(m.id, "view_count", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchMentionField(m.id, "view_count", editCell.value); if (e.key === "Escape") setEditCell(null); }}
                            className="w-full text-xs bg-transparent border-b border-a-blue outline-none py-0.5 text-right" />
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setEditCell({ id: m.id, field: "view_count", value: m.view_count != null ? String(m.view_count) : "" })}
                              className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="조회수 수정">
                              <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            {m.view_count != null ? m.view_count.toLocaleString() : <span className="text-gray-300">-</span>}
                          </div>
                        )}
                      </td>
                      {/* 유형 (무가시딩 / 오가닉) */}
                      <td style={{ minWidth: colWidths[6] }} className="px-4 py-4 whitespace-nowrap">
                        {editCell?.id === m.id && editCell.field === "exposure_type" ? (
                          <select autoFocus value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchMentionField(m.id, "exposure_type", editCell.value)}
                            onKeyDown={e => { if (e.key === "Enter") patchMentionField(m.id, "exposure_type", editCell.value); if (e.key === "Escape") setEditCell(null); }}
                            className="text-xs bg-transparent border-b border-a-blue outline-none py-0.5 w-full">
                            <option value="">-</option>
                            <option value="무가시딩">무가시딩</option>
                            <option value="오가닉">오가닉</option>
                          </select>
                        ) : (
                          <span
                            onClick={() => setEditCell({ id: m.id, field: "exposure_type", value: m.exposure_type ?? "" })}
                            className={`text-xs cursor-text ${m.exposure_type ? "bg-a-parchment px-2 py-0.5 rounded-full text-a-ink" : "text-gray-300"}`}>
                            {m.exposure_type ?? "클릭"}
                          </span>
                        )}
                      </td>
                      {/* 특이사항 */}
                      <td style={{ minWidth: colWidths[7] }} className="px-4 py-4">
                        {editCell?.id === m.id && editCell.field === "notes" ? (
                          <textarea
                            autoFocus
                            rows={2}
                            value={editCell.value}
                            onChange={e => setEditCell(c => c ? { ...c, value: e.target.value } : null)}
                            onBlur={() => patchMentionField(m.id, "notes", editCell.value)}
                            onKeyDown={e => { if (e.key === "Escape") setEditCell(null); }}
                            className="text-xs w-full bg-transparent border-b border-a-blue outline-none py-0.5 resize-none text-a-ink"
                          />
                        ) : (
                          <span
                            onClick={() => setEditCell({ id: m.id, field: "notes", value: m.notes ?? "" })}
                            className="text-xs cursor-text text-a-ink-muted hover:text-a-ink transition-colors line-clamp-2 block"
                          >
                            {m.notes || <span className="text-gray-300">-</span>}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditCell({ id: m.id, field: "mentioned_product", value: m.mentioned_product ?? "" })}
                            className="text-a-ink-muted hover:text-a-ink transition"
                            title="수정">
                            <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                              <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                          <button onClick={() => deleteMention(m.id)}
                            className="text-a-ink-muted hover:text-red-500 text-xs transition">삭제</button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {mentions.length === 0 && !loading && (
                    <tr>
                      <td colSpan={10} className="px-5 py-14 text-center">
                        <p className="text-sm font-medium text-a-ink mb-1">수집된 게시물이 없습니다</p>
                        <p className="text-xs text-a-ink-muted">'지금 수집' 버튼으로 라라스윗 언급 게시물을 자동 수집하거나, 직접 추가할 수 있습니다.</p>
                      </td>
                    </tr>
                  )}
                  {mentions.length > 0 && filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-5 py-12 text-center">
                        <p className="text-sm text-a-ink-muted mb-2">필터 조건에 맞는 게시물이 없습니다.</p>
                        <button onClick={() => setFilters(INIT_FILTERS)} className="text-xs text-a-blue hover:underline">필터 초기화</button>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* 게시물 추가 모달 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[22px] p-6 w-[440px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-4">게시물 추가</h2>
            <div className="space-y-3">
              <input placeholder="게시물 URL (필수)" value={addForm.url}
                onChange={e => setAddForm(p => ({ ...p, url: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
              <div className="flex gap-2">
                <select value={addForm.platform}
                  onChange={e => setAddForm(p => ({ ...p, platform: e.target.value }))}
                  className="flex-1 border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm text-a-ink focus:outline-none focus:border-a-blue transition">
                  {PLATFORMS.map(pl => <option key={pl} value={pl}>{pl}</option>)}
                </select>
                <input placeholder="계정명" value={addForm.account_name}
                  onChange={e => setAddForm(p => ({ ...p, account_name: e.target.value }))}
                  className="flex-1 border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
              </div>
              <textarea placeholder="내용 요약" value={addForm.content_summary}
                onChange={e => setAddForm(p => ({ ...p, content_summary: e.target.value }))}
                rows={2}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition resize-none" />
              <input placeholder="언급 제품" value={addForm.mentioned_product}
                onChange={e => setAddForm(p => ({ ...p, mentioned_product: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] text-a-ink-muted mb-1 block">업로드일</label>
                  <input type="date" value={addForm.uploaded_at}
                    onChange={e => setAddForm(p => ({ ...p, uploaded_at: e.target.value }))}
                    className="w-full border border-a-hairline rounded-[10px] px-3 py-2 text-sm focus:outline-none focus:border-a-blue transition" />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] text-a-ink-muted mb-1 block">조회수</label>
                  <input type="number" placeholder="0" value={addForm.view_count}
                    onChange={e => setAddForm(p => ({ ...p, view_count: e.target.value }))}
                    className="w-full border border-a-hairline rounded-[10px] px-3 py-2 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue transition" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => { setShowAdd(false); setAddForm({ url: "", account_name: "", platform: "인스타그램", content_summary: "", mentioned_product: "", uploaded_at: "", view_count: "" }); }}
                className="btn-ghost">취소</button>
              <button onClick={addMention} disabled={adding || !addForm.url} className="btn-primary px-5 py-2 text-sm">
                {adding ? "추가 중..." : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CSV 업로드 모달 */}
      {showUpload && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[22px] p-6 w-[480px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-1">CSV 일괄 업로드</h2>
            <p className="text-xs text-a-ink-muted mb-4">컬럼 순서: 플랫폼, URL, 계정명, 캡션, 언급제품, 업로드일, 조회수 (헤더 행 필수)</p>
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
                        <th className="px-3 py-1.5 text-left font-medium">플랫폼</th>
                        <th className="px-3 py-1.5 text-left font-medium">계정명</th>
                        <th className="px-3 py-1.5 text-left font-medium">언급제품</th>
                        <th className="px-3 py-1.5 text-left font-medium">URL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} className="border-b border-a-divider last:border-0">
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.platform}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.account_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.mentioned_product ?? "-"}</td>
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

      {/* 타임아웃 모달 */}
      {showTimeoutError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowTimeoutError(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[420px] p-7">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-semibold text-red-500 tracking-[0.1em] uppercase mb-1">시간 초과</p>
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">수집 지연 안내</h2>
              </div>
              <button onClick={() => setShowTimeoutError(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <p className="text-sm text-a-ink-muted leading-relaxed mb-5">
              5분 내에 수집이 완료되지 않았습니다. 작업은 백그라운드에서 계속 실행 중입니다. 완료 후 페이지를 새로고침하면 결과를 확인할 수 있습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowTimeoutError(false)}
                className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment transition">닫기</button>
              <button onClick={() => { setShowTimeoutError(false); window.location.reload(); }}
                className="text-xs px-4 py-2 rounded-full bg-a-blue text-white hover:bg-a-blue-hover transition">새로고침</button>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <HelpModal title="무상 노출 사용 안내" onClose={() => setShowHelp(false)}>
          <HelpSection title="이 탭에서 하는 일">
            <p className="text-a-ink-muted leading-relaxed">인스타그램·유튜브 등에서 라라스윗을 자발적으로 언급한 게시물을 수집하고 관리합니다. 협찬 없이 자연 발생한 노출을 추적합니다.</p>
          </HelpSection>
          <HelpSection title="버튼 설명">
            <HelpItem label="지금 수집 —">Apify를 통해 인스타그램·유튜브에서 '라라스윗' 언급 게시물을 자동 수집합니다.</HelpItem>
            <HelpItem label="CSV 업로드 —">블로그·틱톡·스레드 등 자동 수집이 어려운 플랫폼의 게시물을 CSV로 일괄 등록합니다.</HelpItem>
            <HelpItem label="+ 게시물 추가 —">게시물을 개별 수동 등록합니다.</HelpItem>
          </HelpSection>
          <HelpSection title="언급 제품">
            <p className="text-a-ink-muted leading-relaxed">테이블에서 '언급 제품' 셀을 클릭하면 직접 입력할 수 있습니다.</p>
          </HelpSection>
          <HelpSection title="열 너비 조정">
            <p className="text-a-ink-muted leading-relaxed">각 열 오른쪽 경계선을 드래그하면 너비를 자유롭게 조정할 수 있습니다.</p>
          </HelpSection>
        </HelpModal>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
