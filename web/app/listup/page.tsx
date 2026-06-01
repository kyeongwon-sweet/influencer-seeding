"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";

type Keyword = { id: string; keyword: string; platform: string; created_at: string };
type ScreeningMetrics = { avg_views_per_follower: number | null };
type Influencer = {
  id: string; name: string; url: string; platform: string; status: string; source: string;
  created_at: string; keyword?: string; sample_post_url?: string; post_type?: string;
  post_uploaded_at?: string; notes?: string | null; screening_metrics?: ScreeningMetrics[];
};

const PLATFORM_OPTIONS = [
  { value: "instagram", label: "인스타그램" },
  { value: "youtube",   label: "유튜브" },
  { value: "both",      label: "전체" },
];
const PLATFORM_LABEL: Record<string, string> = { instagram: "인스타", youtube: "유튜브", both: "전체" };

const STATUS_OPTIONS = [
  { value: "pass",    label: "통과" },
  { value: "hold",    label: "보류" },
  { value: "reject",  label: "탈락" },
  { value: "pending", label: "대기중" },
];
const STATUS_CLS: Record<string, string> = {
  pass:    "bg-green-100 text-green-700",
  hold:    "bg-yellow-100 text-yellow-700",
  reject:  "bg-red-100 text-red-700",
  pending: "bg-a-divider text-a-ink-muted",
};
const STATUS_LABEL: Record<string, string> = { pass: "통과", hold: "보류", reject: "탈락", pending: "대기중" };

type Filters = { name: string; platform: string; status: string; keyword: string; uploadedFrom: string; uploadedTo: string };
const INIT_FILTERS: Filters = { name: "", platform: "all", status: "all", keyword: "all", uploadedFrom: "", uploadedTo: "" };

// 드래그 리사이즈 가능한 열 기본 너비 (px)
// [채널명, 플랫폼, 발굴 키워드, 게시물, 유형, 업로드일, 조회/팔로워, 상태, 추가일, 특이사항]
const INIT_COL_WIDTHS = [200, 80, 130, 64, 72, 100, 120, 84, 100, 160];

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatElapsed(s: number): string {
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${s % 60}초`;
}

function FilterSelect({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  const active = value !== "all";
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`filter-select ${active ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
    >
      {children}
    </select>
  );
}

export default function ListupPage() {
  const { toasts, show: toast } = useToast();
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [form, setForm] = useState({ keyword: "", platform: "instagram" });
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", url: "" });
  const [addingManual, setAddingManual] = useState(false);
  const [filters, setFilters] = useState<Filters>(INIT_FILTERS);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showHelp, setShowHelp] = useState(false);
  const [lastListupAt, setLastListupAt] = useState<string | null>(null);
  const [colWidths, setColWidths] = useState<number[]>(INIT_COL_WIDTHS);
  const [showTimeoutError, setShowTimeoutError] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [editName, setEditName] = useState<{ id: string; value: string } | null>(null);
  const [editNotes, setEditNotes] = useState<{ id: string; value: string } | null>(null);
  const [editKeyword, setEditKeyword] = useState<{ id: string; value: string } | null>(null);
  const resizingRef = useRef<{ colIdx: number; startX: number; startW: number } | null>(null);
  const runningJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoScreenAfterListup = useRef(false); // 리스트업 완료 후 자동 스크리닝 여부

  const uniqueKeywords = [...new Set(influencers.map(i => i.keyword).filter(Boolean))] as string[];

  const filteredInfluencers = influencers.filter(inf => {
    if (filters.name && !inf.name.toLowerCase().includes(filters.name.toLowerCase())) return false;
    if (filters.platform !== "all" && inf.platform !== filters.platform) return false;
    if (filters.status !== "all" && inf.status !== filters.status) return false;
    if (filters.keyword !== "all" && inf.keyword !== filters.keyword) return false;
    if (filters.uploadedFrom && inf.post_uploaded_at) {
      if (new Date(inf.post_uploaded_at) < new Date(filters.uploadedFrom)) return false;
    }
    if (filters.uploadedTo && inf.post_uploaded_at) {
      if (new Date(inf.post_uploaded_at) > new Date(filters.uploadedTo + "T23:59:59Z")) return false;
    }
    return true;
  });

  const hasFilter = filters.name !== "" || filters.platform !== "all" || filters.status !== "all" || filters.keyword !== "all" || filters.uploadedFrom !== "" || filters.uploadedTo !== "";

  useEffect(() => {
    Promise.all([loadKeywords(), loadInfluencers()]).finally(() => setLoading(false));
    checkAndResumeListup();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  async function loadKeywords() {
    const res = await fetch("/api/keywords");
    setKeywords(await res.json());
  }

  async function loadInfluencers() {
    const res = await fetch("/api/influencers");
    const data: Influencer[] = await res.json();
    const filtered = data.filter(i => i.source === "listup" || i.source === "manual");
    setInfluencers(filtered);
    const maxAt = filtered.map(i => i.created_at).filter(Boolean).sort().reverse()[0];
    if (maxAt) setLastListupAt(maxAt);
  }

  function startResize(e: React.MouseEvent, colIdx: number) {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = { colIdx, startX: e.clientX, startW: colWidths[colIdx] };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(50, resizingRef.current.startW + delta);
      setColWidths(prev => {
        const next = [...prev];
        next[resizingRef.current!.colIdx] = newW;
        return next;
      });
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function addKeyword() {
    if (!form.keyword.trim()) return;
    setAdding(true);
    await fetch("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: form.keyword.trim(), platform: form.platform }),
    });
    setForm({ keyword: "", platform: "instagram" });
    setAdding(false);
    await loadKeywords();
  }

  async function deleteInfluencer(id: string) {
    if (!confirm("계정을 삭제하시겠습니까?")) return;
    await fetch(`/api/influencers/${id}`, { method: "DELETE" });
    setInfluencers(prev => prev.filter(i => i.id !== id));
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}개 계정을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    await Promise.all([...selected].map(id => fetch(`/api/influencers/${id}`, { method: "DELETE" })));
    setInfluencers(prev => prev.filter(i => !selected.has(i.id)));
    setSelected(new Set());
    setDeleting(false);
  }

  async function deleteAll() {
    if (influencers.length === 0) return;
    if (!confirm(`발굴된 계정 ${influencers.length}개를 모두 삭제하시겠습니까?`)) return;
    setDeleting(true);
    await Promise.all(influencers.map(i => fetch(`/api/influencers/${i.id}`, { method: "DELETE" })));
    setInfluencers([]);
    setSelected(new Set());
    setDeleting(false);
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function toggleSelectAll() {
    const ids = filteredInfluencers.map(i => i.id);
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id));
    if (allSelected) {
      setSelected(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s; });
    } else {
      setSelected(prev => new Set([...prev, ...ids]));
    }
  }

  async function addInfluencerManual() {
    if (!addForm.name || !addForm.url) return;
    setAddingManual(true);
    const platform = addForm.url.toLowerCase().includes("youtube") ? "youtube" : "instagram";
    await fetch("/api/influencers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...addForm, platform, source: "manual", status: "pending" }),
    });
    setAddForm({ name: "", url: "" });
    setShowAdd(false);
    setAddingManual(false);
    await loadInfluencers();
    toast("계정이 추가됐습니다.", "success");
  }

  function downloadCSV() {
    const headers = ["채널명", "URL", "플랫폼", "발굴 키워드", "게시물 URL", "유형", "업로드일", "조회/팔로워", "상태", "추가일"];
    const rows = sortedInfluencers.map(inf => [
      inf.name,
      inf.url,
      inf.platform === "instagram" ? "인스타" : "유튜브",
      inf.keyword ? `#${inf.keyword}` : "",
      inf.sample_post_url ?? "",
      inf.post_type ?? "",
      inf.post_uploaded_at ? new Date(inf.post_uploaded_at).toLocaleDateString("ko-KR") : "",
      inf.screening_metrics?.[0]?.avg_views_per_follower != null
        ? String(inf.screening_metrics[0].avg_views_per_follower) : "",
      STATUS_LABEL[inf.status] ?? inf.status,
      new Date(inf.created_at).toLocaleDateString("ko-KR"),
    ]);
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `리스트업_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function patchNotes(id: string, notes: string) {
    const res = await fetch(`/api/influencers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes || null }),
    });
    if (res.ok) {
      setInfluencers(prev => prev.map(i => i.id === id ? { ...i, notes: notes || null } : i));
    }
    setEditNotes(null);
  }

  async function patchKeyword(id: string, keyword: string) {
    const res = await fetch(`/api/influencers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword: keyword.trim() || null }),
    });
    if (res.ok) {
      setInfluencers(prev => prev.map(i => i.id === id ? { ...i, keyword: keyword.trim() || undefined } : i));
    } else {
      toast("저장에 실패했습니다.", "error");
    }
    setEditKeyword(null);
  }

  async function patchInfluencerName(id: string, name: string) {
    const res = await fetch(`/api/influencers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setInfluencers(prev => prev.map(i => i.id === id ? { ...i, name } : i));
    } else {
      toast("저장에 실패했습니다.", "error");
    }
    setEditName(null);
  }

  async function deleteKeyword(id: string) {
    await fetch(`/api/keywords/${id}`, { method: "DELETE" });
    setKeywords(prev => prev.filter(k => k.id !== id));
  }

  async function checkAndResumeListup() {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) return;
      const jobs: { id: string; type: string; status: string }[] = await res.json();
      const inProgress = jobs.find(j => j.type === "listup" && j.status === "running");
      if (!inProgress) return;
      runningJobIdRef.current = inProgress.id;
      setRunning(true);
      setElapsedSeconds(0);
      elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);
      const startTime = Date.now();
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
        await checkListupJob();
      }, 10_000);
    } catch { /* 무시 */ }
  }

  async function checkListupJob() {
    try {
      const jobRes = await fetch("/api/jobs");
      const jobs: { id: string; status: string; error?: string }[] = await jobRes.json();
      const cur = jobs.find(j => j.id === runningJobIdRef.current);
      if (cur?.status === "done") {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null;
        elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        await loadInfluencers();
        const added = (cur as { payload?: { added?: number } }).payload?.added ?? 0;
        if (added > 0 && autoScreenAfterListup.current) {
          toast(`리스트업 완료: ${added}명 추가. 스크리닝을 자동으로 시작합니다…`, "success");
          try {
            const screenRes = await fetch("/api/jobs", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ type: "screening", payload: {} }),
            });
            if (screenRes.ok) {
              toast("스크리닝이 시작됐습니다. 스크리닝 탭에서 확인하세요.", "info");
            } else {
              toast("스크리닝 자동 시작에 실패했습니다. 스크리닝 탭에서 직접 실행해주세요.", "error");
            }
          } catch {
            toast("스크리닝 자동 시작에 실패했습니다. 스크리닝 탭에서 직접 실행해주세요.", "error");
          }
        } else {
          toast(added > 0 ? `리스트업 완료: ${added}명 추가됐습니다.` : "리스트업 완료: 신규 계정 없음.", "success");
        }
        autoScreenAfterListup.current = false;
      } else if (cur?.status === "failed") {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null;
        elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        toast(`리스트업에 실패했습니다: ${cur.error ?? "알 수 없는 오류"}`, "error");
      }
    } catch { /* 폴링 오류 무시 */ }
  }

  async function runListup() {
    if (keywords.length === 0) { toast("검색 키워드를 먼저 추가해주세요.", "error"); return; }
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setRunning(true);
    setShowTimeoutError(false);
    setElapsedSeconds(0);
    autoScreenAfterListup.current = true; // 완료 시 자동 스크리닝 트리거

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "listup", payload: {} }),
    });

    if (!res.ok) {
      setRunning(false);
      toast("리스트업 실행에 실패했습니다.", "error");
      return;
    }

    const { job } = await res.json();
    runningJobIdRef.current = job.id;
    toast("리스트업이 시작됐습니다. 완료 시 자동으로 업데이트됩니다.", "info");

    elapsedTimerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);

    const startTime = Date.now();
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
      await checkListupJob();
    }, 10_000);
  }

  const allFilteredSelected = filteredInfluencers.length > 0 && filteredInfluencers.every(i => selected.has(i.id));

  function handleSort(col: string) {
    setSortDir(prev => sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  }

  const sortedInfluencers = [...filteredInfluencers].sort((a, b) => {
    if (!sortCol) return 0;
    if (sortCol === "조회/팔로워") {
      const av = a.screening_metrics?.[0]?.avg_views_per_follower ?? -1;
      const bv = b.screening_metrics?.[0]?.avg_views_per_follower ?? -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    }
    let av: string | number = "", bv: string | number = "";
    switch (sortCol) {
      case "채널명": av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
      case "플랫폼": av = a.platform; bv = b.platform; break;
      case "발굴 키워드": av = a.keyword ?? ""; bv = b.keyword ?? ""; break;
      case "유형": av = a.post_type ?? ""; bv = b.post_type ?? ""; break;
      case "업로드일": av = a.post_uploaded_at ?? ""; bv = b.post_uploaded_at ?? ""; break;
      case "상태": av = a.status; bv = b.status; break;
      case "추가일": av = a.created_at; bv = b.created_at; break;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  // 정렬 + 드래그 리사이즈 th
  function rsTH(col: string, colIdx: number, sortable = true, tooltip?: React.ReactNode) {
    const active = sortCol === col;
    return (
      <th
        key={col}
        style={{ minWidth: colWidths[colIdx] }}
        className={`relative px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider whitespace-nowrap bg-white select-none group ${
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
        {tooltip && (
          <div className="hidden group-hover:block absolute top-full left-0 mt-1 z-50 bg-white border border-a-hairline rounded-[10px] shadow-lg px-3 py-2.5 text-left min-w-[260px] normal-case tracking-normal font-normal">
            {tooltip}
          </div>
        )}
        <div
          onMouseDown={e => startResize(e, colIdx)}
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-100 z-10"
        />
      </th>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-a-ink transition text-sm">←</Link>
          <span className="text-a-ink text-sm font-semibold tracking-tight">리스트업</span>
          {influencers.length > 0 && (
            <span className="text-gray-400 text-xs">{influencers.length}명</span>
          )}
        </div>
      </header>

      <div className="sticky top-11 z-[35] bg-white border-b border-a-hairline px-6 h-11 flex items-center justify-between">
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
          {lastListupAt && (
            <span className="text-xs text-a-ink-muted whitespace-nowrap">
              마지막 업데이트 <span className="font-medium text-a-ink">{formatTimestamp(lastListupAt)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowAdd(true)} className="btn-secondary">+ 계정 추가</button>
          {running && (
            <>
              <span className="text-xs text-a-ink-muted tabular-nums">{formatElapsed(elapsedSeconds)}</span>
              <button onClick={checkListupJob} className="btn-secondary">지금 확인</button>
            </>
          )}
          <button onClick={runListup} disabled={running} className="btn-primary">
            {running ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                실행 중
              </span>
            ) : "리스트업 실행"}
          </button>
        </div>
      </div>

      <div className="px-6 py-6 space-y-4">
        {/* 키워드 관리 */}
        <div className="bg-white rounded-[18px] border border-a-hairline p-6">
          <p className="text-[11px] font-semibold text-a-ink-muted tracking-widest uppercase mb-4">검색 키워드</p>
          <div className="flex gap-2 mb-5">
            <input
              placeholder="해시태그 (# 제외)"
              value={form.keyword}
              onChange={e => setForm(p => ({ ...p, keyword: e.target.value }))}
              onKeyDown={e => e.key === "Enter" && addKeyword()}
              className="filter-input flex-1"
            />
            <select
              value={form.platform}
              onChange={e => setForm(p => ({ ...p, platform: e.target.value }))}
              className="filter-select"
            >
              {PLATFORM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={addKeyword} disabled={adding || !form.keyword.trim()} className="btn-primary">
              추가
            </button>
          </div>
          {loading ? (
            <p className="text-sm text-a-ink-muted">로딩 중...</p>
          ) : keywords.length === 0 ? (
            <div className="text-center py-5">
              <p className="text-sm text-a-ink-muted">키워드를 입력하면 해당 해시태그로 인플루언서를 자동 발굴합니다.</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {keywords.map(k => (
                <div key={k.id} className="flex items-center gap-1 bg-a-parchment border border-a-hairline rounded-full px-2.5 py-1">
                  <span className="text-[10px] text-a-ink-muted leading-none">{PLATFORM_LABEL[k.platform] ?? k.platform}</span>
                  <span className="text-xs text-a-ink font-medium leading-none">#{k.keyword}</span>
                  <button onClick={() => deleteKeyword(k.id)}
                    className="ml-0.5 w-3.5 h-3.5 flex items-center justify-center rounded-full text-a-ink-muted hover:bg-gray-200 hover:text-a-ink transition">
                    <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
                      <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 발굴된 계정 */}
        <div className="bg-white rounded-[18px] border border-a-hairline overflow-hidden">
          {/* 카드 헤더 */}
          <div className="px-6 py-4 border-b border-a-hairline flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold text-a-ink-muted tracking-widest uppercase">발굴된 계정</p>
              {influencers.length > 0 && (
                <span className="text-xs text-a-ink-muted">
                  {hasFilter && filteredInfluencers.length !== influencers.length
                    ? `${filteredInfluencers.length} / ${influencers.length}명`
                    : `${influencers.length}명`}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {selected.size > 0 && (
                <button onClick={deleteSelected} disabled={deleting}
                  className="text-xs px-3 py-1.5 rounded-full border border-red-300 text-red-500 hover:bg-red-50 disabled:opacity-40 transition">
                  선택 삭제 ({selected.size})
                </button>
              )}
              <button onClick={downloadCSV} disabled={filteredInfluencers.length === 0}
                className="text-xs px-3.5 py-1.5 rounded-full border border-a-hairline bg-white text-a-ink-muted hover:bg-a-parchment disabled:opacity-40 transition">
                엑셀 다운로드
              </button>
              <button onClick={deleteAll} disabled={deleting || influencers.length === 0}
                className="text-xs px-3 py-1.5 rounded-full border border-a-hairline text-a-ink-muted hover:border-red-300 hover:text-red-500 disabled:opacity-40 transition">
                전체 삭제
              </button>
            </div>
          </div>

          {/* 필터 바 */}
          {!loading && influencers.length > 0 && (
            <div className="px-5 py-3 border-b border-a-hairline flex items-center gap-2 flex-wrap bg-a-parchment/40">
              <input
                type="text"
                placeholder="채널명 검색"
                value={filters.name}
                onChange={e => setFilters(p => ({ ...p, name: e.target.value }))}
                className={`border rounded-[8px] px-3 py-1.5 text-xs w-36 focus:outline-none transition placeholder:text-a-ink-muted ${
                  filters.name ? "border-a-blue" : "border-a-hairline"
                }`}
              />
              <FilterSelect value={filters.platform} onChange={v => setFilters(p => ({ ...p, platform: v }))}>
                <option value="all">전체 플랫폼</option>
                <option value="instagram">인스타</option>
                <option value="youtube">유튜브</option>
              </FilterSelect>
              <FilterSelect value={filters.status} onChange={v => setFilters(p => ({ ...p, status: v }))}>
                <option value="all">전체 상태</option>
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </FilterSelect>
              {uniqueKeywords.length > 0 && (
                <FilterSelect value={filters.keyword} onChange={v => setFilters(p => ({ ...p, keyword: v }))}>
                  <option value="all">전체 키워드</option>
                  {uniqueKeywords.map(k => <option key={k} value={k}>#{k}</option>)}
                </FilterSelect>
              )}
              <div className="flex items-center gap-1">
                <span className="text-xs text-a-ink-muted whitespace-nowrap">업로드일</span>
                <input
                  type="date"
                  value={filters.uploadedFrom}
                  onChange={e => setFilters(p => ({ ...p, uploadedFrom: e.target.value }))}
                  className={`filter-input ${filters.uploadedFrom ? "border-a-blue" : ""}`}
                />
                <span className="text-xs text-a-ink-muted">~</span>
                <input
                  type="date"
                  value={filters.uploadedTo}
                  onChange={e => setFilters(p => ({ ...p, uploadedTo: e.target.value }))}
                  className={`filter-input ${filters.uploadedTo ? "border-a-blue" : ""}`}
                />
              </div>
              {hasFilter && (
                <button onClick={() => setFilters(INIT_FILTERS)}
                  className="text-xs text-a-ink-muted hover:text-a-ink transition px-1">
                  초기화
                </button>
              )}
            </div>
          )}

          {loading ? (
            <div className="p-8 text-center text-a-ink-muted text-sm">로딩 중...</div>
          ) : influencers.length === 0 ? (
            <div className="py-14 px-6 text-center">
              <p className="text-sm font-medium text-a-ink mb-1">발굴된 계정이 없습니다</p>
              <p className="text-xs text-a-ink-muted mb-5">
                {keywords.length === 0
                  ? "키워드를 추가하고 리스트업을 실행하면 계정이 자동으로 수집됩니다."
                  : "상단 '리스트업 실행' 버튼을 눌러 계정을 발굴해 보세요."}
              </p>
              {keywords.length > 0 && (
                <button onClick={runListup} disabled={running}
                  className="bg-a-blue text-white rounded-full px-5 py-2 text-sm hover:bg-a-blue-hover disabled:opacity-40 transition">
                  {running ? "실행 중..." : "리스트업 실행"}
                </button>
              )}
            </div>
          ) : filteredInfluencers.length === 0 ? (
            <div className="py-12 px-6 text-center">
              <p className="text-sm text-a-ink-muted mb-2">필터 조건에 맞는 계정이 없습니다.</p>
              <button onClick={() => setFilters(INIT_FILTERS)}
                className="text-xs text-a-blue hover:underline">필터 초기화</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-30">
                  <tr className="border-b border-a-hairline">
                    <th className="pl-5 pr-2 py-3 w-9 bg-white">
                      <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll}
                        className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                    </th>
                    {rsTH("채널명", 0)}
                    {rsTH("플랫폼", 1, true, (
                      <div>
                        <p className="text-[11px] font-semibold text-a-ink mb-2">수집 기준</p>
                        <div className="space-y-1.5">
                          <div className="flex gap-2">
                            <span className="text-[11px] text-a-ink-muted w-20 flex-shrink-0">인스타그램</span>
                            <span className="text-[11px] text-a-ink leading-relaxed">해시태그로 최근 100개 수집 → 릴스만 저장</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-[11px] text-a-ink-muted w-20 flex-shrink-0">유튜브</span>
                            <span className="text-[11px] text-a-ink leading-relaxed">검색어로 쇼츠만 최대 30개 수집</span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-[11px] text-a-ink-muted w-20 flex-shrink-0">중복 제거</span>
                            <span className="text-[11px] text-a-ink leading-relaxed">DB에 있는 URL은 스킵</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {rsTH("발굴 키워드", 2)}
                    {rsTH("게시물", 3, false)}
                    {rsTH("유형", 4)}
                    {rsTH("업로드일", 5)}
                    {rsTH("조회/팔로워", 6)}
                    {(() => {
                      const col = "상태";
                      const active = sortCol === col;
                      return (
                        <th
                          key={col}
                          style={{ minWidth: colWidths[7] }}
                          className={`relative px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider whitespace-nowrap bg-white select-none group ${
                            active ? "text-a-ink" : "text-gray-400"
                          }`}
                        >
                          <span onClick={() => handleSort(col)} className="cursor-pointer hover:text-gray-600 transition-colors">
                            {col}
                            <span className={`ml-1 ${active ? "text-a-blue" : "opacity-20"}`}>
                              {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
                            </span>
                          </span>
                          <div className="hidden group-hover:block absolute top-full left-0 mt-0.5 z-50 bg-white border border-a-hairline rounded-[10px] shadow-lg px-3 py-2.5 text-left whitespace-nowrap">
                            <p className="text-[11px] font-semibold text-a-ink mb-0.5">스크리닝과 자동 동기화</p>
                            <p className="text-[11px] text-a-ink-muted leading-relaxed">스크리닝에서 통과/탈락을 설정하면<br/>이 탭의 상태가 자동으로 반영됩니다.</p>
                          </div>
                          <div
                            onMouseDown={e => startResize(e, 7)}
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-100 z-10"
                          />
                        </th>
                      );
                    })()}
                    {rsTH("추가일", 8)}
                    {rsTH("특이사항", 9, false)}
                    <th className="px-4 py-3 bg-white"></th>
                  </tr>
                </thead>
                <tbody>
                  {sortedInfluencers.map(inf => {
                    const ratio = inf.screening_metrics?.[0]?.avg_views_per_follower;
                    return (
                      <tr key={inf.id} className={`group border-b border-a-divider last:border-0 hover:bg-a-parchment/60 transition-colors ${selected.has(inf.id) ? "bg-blue-50/40" : ""}`}>
                        <td className="pl-5 pr-2 py-4 w-9">
                          <input type="checkbox" checked={selected.has(inf.id)} onChange={() => toggleSelect(inf.id)}
                            className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                        </td>
                        <td className="px-4 py-4">
                          <div style={{ width: colWidths[0] - 32, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {editName?.id === inf.id ? (
                              <input autoFocus value={editName.value}
                                onChange={e => setEditName(v => v ? { ...v, value: e.target.value } : null)}
                                onBlur={() => patchInfluencerName(inf.id, editName.value)}
                                onKeyDown={e => { if (e.key === "Enter") patchInfluencerName(inf.id, editName.value); if (e.key === "Escape") setEditName(null); }}
                                className="w-full text-sm font-medium bg-transparent border-b border-a-blue outline-none py-0.5" />
                            ) : (
                              <a href={inf.url} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 font-medium hover:text-a-blue transition-colors group/link">
                                {inf.name}
                                <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="opacity-0 group-hover/link:opacity-50 flex-shrink-0 transition-opacity">
                                  <path d="M5.5 2.5H2.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                  <path d="M8.5 1.5h4m0 0v4m0-4L6 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-a-ink-muted text-xs whitespace-nowrap">
                          {inf.platform === "instagram" ? "인스타" : "유튜브"}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          {editKeyword?.id === inf.id ? (
                            <input
                              autoFocus
                              value={editKeyword.value}
                              onChange={e => setEditKeyword(v => v ? { ...v, value: e.target.value } : null)}
                              onBlur={() => patchKeyword(inf.id, editKeyword.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") patchKeyword(inf.id, editKeyword.value);
                                if (e.key === "Escape") setEditKeyword(null);
                              }}
                              placeholder="키워드 (# 제외)"
                              className="text-xs w-24 bg-transparent border-b border-a-blue outline-none py-0.5"
                            />
                          ) : (
                            <span
                              onClick={() => setEditKeyword({ id: inf.id, value: inf.keyword ?? "" })}
                              className="cursor-pointer flex items-center gap-1 group/kw"
                            >
                              {inf.keyword
                                ? <span className="text-xs bg-a-parchment text-a-ink-muted px-2 py-0.5 rounded-full">#{inf.keyword}</span>
                                : <span className="text-xs text-gray-300">-</span>}
                              <svg width="10" height="10" viewBox="0 0 20 20" fill="none" className="opacity-0 group-hover/kw:opacity-40 transition-opacity flex-shrink-0">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          {inf.sample_post_url
                            ? <a href={inf.sample_post_url} target="_blank" rel="noreferrer"
                                className="text-xs text-a-blue hover:underline">보기 →</a>
                            : <span className="text-xs text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          {inf.post_type
                            ? <span className="text-xs bg-a-parchment text-a-ink-muted px-2 py-0.5 rounded-full">{inf.post_type}</span>
                            : <span className="text-xs text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-4 text-a-ink-muted text-xs whitespace-nowrap">
                          {inf.post_uploaded_at
                            ? new Date(inf.post_uploaded_at).toLocaleDateString("ko-KR")
                            : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-4 text-xs whitespace-nowrap">
                          {ratio != null
                            ? <span className="font-medium text-a-ink">{Number(ratio).toFixed(2)}</span>
                            : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap">
                          <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_CLS[inf.status] ?? STATUS_CLS.pending}`}>
                            {STATUS_LABEL[inf.status] ?? inf.status}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-a-ink-muted text-xs whitespace-nowrap">
                          {new Date(inf.created_at).toLocaleDateString("ko-KR")}
                        </td>
                        <td className="px-4 py-3" style={{ minWidth: colWidths[9] }}>
                          {editNotes?.id === inf.id ? (
                            <textarea
                              autoFocus
                              rows={2}
                              value={editNotes.value}
                              onChange={e => setEditNotes(v => v ? { ...v, value: e.target.value } : null)}
                              onBlur={() => patchNotes(inf.id, editNotes.value)}
                              onKeyDown={e => { if (e.key === "Escape") setEditNotes(null); }}
                              className="text-xs w-full bg-transparent border-b border-a-blue outline-none py-0.5 resize-none text-a-ink"
                            />
                          ) : (
                            <span
                              onClick={() => setEditNotes({ id: inf.id, value: inf.notes ?? "" })}
                              className="text-xs cursor-text text-a-ink-muted hover:text-a-ink transition-colors line-clamp-2 block"
                            >
                              {inf.notes || <span className="text-gray-300">-</span>}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setEditName({ id: inf.id, value: inf.name })}
                              className="text-a-ink-muted hover:text-a-ink transition" title="이름 수정">
                              <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                                <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                            <button onClick={() => deleteInfluencer(inf.id)}
                              className="text-a-ink-muted hover:text-red-500 text-xs transition">삭제</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 스크리닝 이동 안내 */}
        {!loading && influencers.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 bg-white rounded-[14px] border border-a-hairline">
            <span className="text-xs text-a-ink-muted">발굴이 완료됐다면 스크리닝에서 지표를 확인하세요.</span>
            <Link href="/screening" className="text-xs font-medium text-a-blue hover:underline">
              스크리닝으로 →
            </Link>
          </div>
        )}
      </div>

      {showHelp && (
        <HelpModal title="리스트업 사용 안내" onClose={() => setShowHelp(false)}>
          <HelpSection title="이 탭에서 하는 일">
            <p className="text-a-ink-muted leading-relaxed">특정 브랜드·제품 해시태그가 포함된 게시물(릴스/쇼츠 포함)을 올린 계정을 자동 발굴합니다. 발굴된 계정은 스크리닝 탭에서 상세 지표를 수집합니다.</p>
          </HelpSection>
          <HelpSection title="버튼 설명">
            <HelpItem label="리스트업 실행 —">지정된 해시태그로 Apify를 통해 게시물을 수집하고 계정을 자동 추가합니다. 이미 등록된 계정은 중복 추가되지 않습니다.</HelpItem>
            <HelpItem label="+ 계정 추가 —">채널명과 URL을 직접 입력해 계정을 수동으로 추가합니다.</HelpItem>
            <HelpItem label="선택 삭제 —">체크박스로 선택한 계정을 일괄 삭제합니다.</HelpItem>
          </HelpSection>
          <HelpSection title="조회/팔로워 열">
            <p className="text-a-ink-muted leading-relaxed">스크리닝 완료 후 표시되는 지표입니다. 팔로워 수 대비 평균 재생수 비율로, 높을수록 확산력이 좋은 계정입니다. 이 값으로 정렬하면 시딩 효율이 높은 계정을 우선순위에 올릴 수 있습니다.</p>
          </HelpSection>
          <HelpSection title="열 너비 조정">
            <p className="text-a-ink-muted leading-relaxed">각 열 오른쪽 경계선을 드래그하면 너비를 자유롭게 조정할 수 있습니다.</p>
          </HelpSection>
          <HelpSection title="상태값">
            <HelpItem label="대기중 —">새로 추가된 계정. 아직 스크리닝 전입니다.</HelpItem>
            <HelpItem label="통과 —">스크리닝 후 협찬 후보로 선정된 계정입니다.</HelpItem>
            <HelpItem label="보류 —">판단 보류 중인 계정입니다.</HelpItem>
            <HelpItem label="탈락 —">협찬 후보에서 제외된 계정입니다.</HelpItem>
          </HelpSection>
        </HelpModal>
      )}

      {/* 계정 추가 모달 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white rounded-[22px] p-6 w-96 shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-4">계정 추가</h2>
            <div className="space-y-3">
              <input placeholder="채널명" value={addForm.name}
                onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
              <input placeholder="계정 URL (인스타그램 또는 유튜브)" value={addForm.url}
                onChange={e => setAddForm(p => ({ ...p, url: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => { setShowAdd(false); setAddForm({ name: "", url: "" }); }}
                className="px-4 py-2 text-sm text-a-ink-muted hover:text-a-ink transition rounded-full">취소</button>
              <button onClick={addInfluencerManual} disabled={addingManual || !addForm.name || !addForm.url}
                className="px-5 py-2 text-sm bg-a-blue text-white rounded-full hover:bg-a-blue-hover disabled:opacity-40 transition">
                {addingManual ? "추가 중..." : "추가"}
              </button>
            </div>
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
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">리스트업 지연 안내</h2>
              </div>
              <button onClick={() => setShowTimeoutError(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <p className="text-sm text-a-ink-muted leading-relaxed mb-5">
              5분 내에 리스트업이 완료되지 않았습니다.
              작업은 백그라운드에서 계속 실행 중입니다.
              완료 후 페이지를 새로고침하면 결과를 확인할 수 있습니다.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowTimeoutError(false)}
                className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment transition">
                닫기
              </button>
              <button onClick={() => { setShowTimeoutError(false); window.location.reload(); }}
                className="text-xs px-4 py-2 rounded-full bg-a-blue text-white hover:bg-a-blue-hover transition">
                새로고침
              </button>
            </div>
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
