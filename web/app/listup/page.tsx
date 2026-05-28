"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";

type Keyword = { id: string; keyword: string; platform: string; created_at: string };
type Influencer = { id: string; name: string; url: string; platform: string; status: string; source: string; created_at: string; keyword?: string; sample_post_url?: string; post_type?: string; post_uploaded_at?: string };

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
  }, []);

  async function loadKeywords() {
    const res = await fetch("/api/keywords");
    setKeywords(await res.json());
  }

  async function loadInfluencers() {
    const res = await fetch("/api/influencers");
    const data: Influencer[] = await res.json();
    setInfluencers(data.filter(i => i.source === "listup" || i.source === "manual"));
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
    const headers = ["채널명", "URL", "플랫폼", "발굴 키워드", "게시물 URL", "유형", "업로드일", "상태", "추가일"];
    const rows = sortedInfluencers.map(inf => [
      inf.name,
      inf.url,
      inf.platform === "instagram" ? "인스타" : "유튜브",
      inf.keyword ? `#${inf.keyword}` : "",
      inf.sample_post_url ?? "",
      inf.post_type ?? "",
      inf.post_uploaded_at ? new Date(inf.post_uploaded_at).toLocaleDateString("ko-KR") : "",
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

  async function deleteKeyword(id: string) {
    await fetch(`/api/keywords/${id}`, { method: "DELETE" });
    setKeywords(prev => prev.filter(k => k.id !== id));
  }

  async function runListup() {
    if (keywords.length === 0) { toast("검색 키워드를 먼저 추가해주세요.", "error"); return; }
    setRunning(true);
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "listup", payload: {} }),
    });
    setRunning(false);
    toast("리스트업 작업이 시작됐습니다. 완료까지 수 분이 소요됩니다.", "info");
  }

  const allFilteredSelected = filteredInfluencers.length > 0 && filteredInfluencers.every(i => selected.has(i.id));

  function handleSort(col: string) {
    setSortDir(prev => sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  }

  const sortedInfluencers = [...filteredInfluencers].sort((a, b) => {
    if (!sortCol) return 0;
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

  function sortTH(col: string, right = false) {
    const active = sortCol === col;
    return (
      <th key={col} onClick={() => handleSort(col)}
        className={`px-5 py-3 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap cursor-pointer select-none transition-colors bg-white ${right ? "text-right" : "text-left"} ${
          active ? "text-a-ink" : "text-gray-400 hover:text-gray-600"
        }`}>
        {col}<span className={`ml-1 ${active ? "text-a-blue" : "opacity-20"}`}>{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
      </th>
    );
  }

  return (
    <div className="min-h-screen bg-a-parchment">
      <header className="bg-black h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-white/50 hover:text-white transition text-sm">←</Link>
          <span className="text-white text-sm font-medium tracking-tight">리스트업</span>
          {influencers.length > 0 && (
            <span className="text-white/40 text-xs">{influencers.length}명</span>
          )}
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
          <button onClick={() => setShowAdd(true)} className="btn-secondary">+ 계정 추가</button>
          <button onClick={runListup} disabled={running} className="btn-primary">
            {running ? "실행 중..." : "리스트업 실행"}
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
            <button onClick={addKeyword} disabled={adding || !form.keyword.trim()}
              className="btn-primary">
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
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-30">
                <tr className="border-b border-a-hairline">
                  <th className="pl-5 pr-2 py-3 w-9 bg-white">
                    <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                  </th>
                  {sortTH("채널명")}
                  {sortTH("플랫폼")}
                  {sortTH("발굴 키워드")}
                  <th className="px-5 py-3 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap bg-white">게시물</th>
                  {sortTH("유형")}
                  {sortTH("업로드일")}
                  {sortTH("상태")}
                  {sortTH("추가일")}
                  <th className="px-5 py-3 bg-white"></th>
                </tr>
              </thead>
              <tbody>
                {sortedInfluencers.map(inf => (
                  <tr key={inf.id} className={`border-b border-a-divider last:border-0 hover:bg-a-parchment/60 transition-colors ${selected.has(inf.id) ? "bg-blue-50/40" : ""}`}>
                    <td className="pl-5 pr-2 py-4 w-9">
                      <input type="checkbox" checked={selected.has(inf.id)} onChange={() => toggleSelect(inf.id)}
                        className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <a href={inf.url} target="_blank" rel="noreferrer"
                        className="font-medium hover:text-a-blue transition-colors">{inf.name}</a>
                    </td>
                    <td className="px-5 py-4 text-a-ink-muted text-xs whitespace-nowrap">
                      {inf.platform === "instagram" ? "인스타" : "유튜브"}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {inf.keyword
                        ? <span className="text-xs bg-a-parchment text-a-ink-muted px-2 py-0.5 rounded-full">#{inf.keyword}</span>
                        : <span className="text-xs text-gray-300">-</span>}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {inf.sample_post_url
                        ? <a href={inf.sample_post_url} target="_blank" rel="noreferrer"
                            className="text-xs text-a-blue hover:underline">보기 →</a>
                        : <span className="text-xs text-gray-300">-</span>}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      {inf.post_type
                        ? <span className="text-xs bg-a-parchment text-a-ink-muted px-2 py-0.5 rounded-full">{inf.post_type}</span>
                        : <span className="text-xs text-gray-300">-</span>}
                    </td>
                    <td className="px-5 py-4 text-a-ink-muted text-xs whitespace-nowrap">
                      {inf.post_uploaded_at
                        ? new Date(inf.post_uploaded_at).toLocaleDateString("ko-KR")
                        : <span className="text-gray-300">-</span>}
                    </td>
                    <td className="px-5 py-4 whitespace-nowrap">
                      <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS_CLS[inf.status] ?? STATUS_CLS.pending}`}>
                        {STATUS_LABEL[inf.status] ?? inf.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-a-ink-muted text-xs whitespace-nowrap">
                      {new Date(inf.created_at).toLocaleDateString("ko-KR")}
                    </td>
                    <td className="px-5 py-4 text-right whitespace-nowrap">
                      <button onClick={() => deleteInfluencer(inf.id)}
                        className="text-a-ink-muted hover:text-red-500 text-xs transition">삭제</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            <p className="text-a-ink-muted leading-relaxed">해시태그 기반으로 인스타그램 계정을 자동 발굴합니다. 발굴된 계정은 스크리닝 탭으로 넘어가 지표 수집 대상이 됩니다.</p>
          </HelpSection>
          <HelpSection title="버튼 설명">
            <HelpItem label="리스트업 실행 —">지정된 해시태그로 Apify를 통해 게시물을 수집하고 계정을 자동 추가합니다. 이미 등록된 계정은 중복 추가되지 않습니다.</HelpItem>
            <HelpItem label="+ 계정 추가 —">채널명과 URL을 직접 입력해 계정을 수동으로 추가합니다.</HelpItem>
            <HelpItem label="선택 삭제 —">체크박스로 선택한 계정을 일괄 삭제합니다.</HelpItem>
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

      <ToastContainer toasts={toasts} />
    </div>
  );
}
