"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";
import { platformLabel } from "@/lib/platform";
import { MIN_ENTRY_DATE, maxDateKST, isValidEntryDate } from "@/lib/dateRule";

type Metrics = {
  id: string;
  run_at: string;
  followers: number | null;
  total_avg_play_count: number | null;
  avg_views_per_follower: number | null;
  count_1m_view: number | null;
  total_posts: number | null;
  general_posts: number | null;
  ad_posts: number | null;
  total_avg_view_count: number | null;
  general_avg_view_count: number | null;
  ad_avg_view_count: number | null;
  general_avg_play_count: number | null;
  ad_avg_play_count: number | null;
  total_like_ratio: number | null;
  general_like_ratio: number | null;
  ad_like_ratio: number | null;
  total_comment_ratio: number | null;
  general_comment_ratio: number | null;
  ad_comment_ratio: number | null;
  top_ad_play_count: number | null;
  top_ad_post_url: string | null;
  avg_video_duration: number | null;
  criteria_snapshot: CriteriaSnapshot | null;
  kw_keywords: string | null;
  kw_ad_date: string | null;
  kw_impact: number | null;
  kw_before: number | null;
  kw_after: number | null;
  type_metrics: Record<string, Partial<Metrics>> | null;
};

type CriteriaDetail = {
  label: string;
  op: string;
  threshold: number;
  value: number | null;
  passed: boolean;
};

type CriteriaSnapshot = {
  result: "pass" | "reject" | "no_criteria";
  details: CriteriaDetail[];
};

type Criteria = {
  id: string;
  updated_at: string;
  min_followers: number | null;
  min_1m_count: number | null;
  min_views_per_follower: number | null;
  min_avg_views: number | null;
  max_ad_ratio: number | null;
};

type CriteriaForm = {
  min_followers: string;
  min_1m_count: string;
  min_views_per_follower: string;
  min_avg_views: string;
  max_ad_ratio: string;
};

type Influencer = {
  id: string;
  name: string;
  url: string;
  platform: string;
  status: string;
  category: string | null;
  notes: string | null;
  keyword?: string | null;
  created_at: string;
  screening_metrics: Metrics[];
};

const STATUS = [
  { value: "pending", label: "대기중", cls: "bg-a-divider text-a-ink-muted" },
  { value: "pass",    label: "통과",   cls: "bg-green-100 text-green-700" },
  { value: "hold",    label: "보류",   cls: "bg-yellow-100 text-yellow-700" },
  { value: "reject",  label: "탈락",   cls: "bg-red-100 text-red-700" },
];

const CATEGORIES = [
  { value: "A",   desc: "찐팬서사 (꾸준함)", cls: "bg-blue-50 text-blue-700" },
  { value: "B",   desc: "선망성",            cls: "bg-purple-50 text-purple-700" },
  { value: "C",   desc: "맛잘알",            cls: "bg-green-50 text-green-700" },
  { value: "D",   desc: "친근감",            cls: "bg-amber-50 text-amber-700" },
  { value: "기타", desc: "기타",             cls: "bg-a-divider text-a-ink-muted" },
];

function formatElapsed(s: number): string {
  if (s < 60) return `${s}초`;
  return `${Math.floor(s / 60)}분 ${s % 60}초`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000); // KST 고정
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function fmt(v: number | null | undefined) {
  return v == null ? "-" : v.toLocaleString();
}

function fmtRatio(v: number | null | undefined) {
  return v == null ? "-" : v.toFixed(2) + "%";
}

function latest(inf: Influencer): Metrics | null {
  // 원본 state 배열을 in-place 정렬하면 매 렌더마다 state를 변형 → 복사본을 정렬.
  return [...(inf.screening_metrics ?? [])].sort(
    (a, b) => new Date(b.run_at).getTime() - new Date(a.run_at).getTime()
  )[0] ?? null;
}


export default function ScreeningPage() {
  const { toasts, show: toast } = useToast();
  const [list, setList] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchName, setSearchName] = useState("");
  const [filterPlatform, setFilterPlatform] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("pass");
  const [applying, setApplying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showHelp, setShowHelp] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [criteria, setCriteria] = useState<Criteria | null>(null);
  const [criteriaForm, setCriteriaForm] = useState<CriteriaForm>({
    min_followers: "", min_1m_count: "", min_views_per_follower: "", min_avg_views: "", max_ad_ratio: "",
  });
  const [savingCriteria, setSavingCriteria] = useState(false);
  const [snapshotModal, setSnapshotModal] = useState<CriteriaSnapshot | null>(null);
  const [kwModal, setKwModal] = useState<{ metricsId: string; infName: string } | null>(null);
  const [kwForm, setKwForm] = useState({ keywords: "", adDate: "" });

  // CSV 업로드
  const [showUpload, setShowUpload] = useState(false);
  type CsvRow = { name: string; url: string; platform: string; status: string; category: string | null };
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [kwRunning, setKwRunning] = useState(false);
  const [lastListupAt, setLastListupAt] = useState<string | null>(null);
  const [showTimeoutError, setShowTimeoutError] = useState(false);
  const [blacklist, setBlacklist] = useState<{ account_name: string | null; url: string | null; reason: string | null }[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const runningJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // column widths for drag-resize
  const [channelNameWidth, setChannelNameWidth] = useState(160);
  const [editScreeningName, setEditScreeningName] = useState<{ id: string; value: string } | null>(null);
  const [editNotes, setEditNotes] = useState<{ id: string; value: string } | null>(null);
  const [screenColWidths, setScreenColWidths] = useState<Record<string, number>>({
    "플랫폼": 80, "팔로워 수": 100, "알고리즘 계수": 110, "100만뷰 개수": 110,
    "총 평균 조회수": 120, "총 평균 도달수": 120, "댓글 비율": 90, "광고 비율": 90,
    "광고 평균 조회수": 120, "광고 효율": 90, "광고 최고 조회수": 120,
    "광고 최고 게시물 URL": 120, "검색어": 140, "검색어 트렌드": 110,
    "통과 기준": 90, "상태": 90, "특이사항": 160,
  });
  const screenResizingRef = useRef<{ col: string; startX: number; startW: number; isSticky: boolean } | null>(null);

  function startScreenResize(col: string, e: React.MouseEvent, isSticky = false) {
    e.preventDefault();
    e.stopPropagation();
    const startW = isSticky ? channelNameWidth : screenColWidths[col];
    screenResizingRef.current = { col, startX: e.clientX, startW, isSticky };
    function onMove(ev: MouseEvent) {
      if (!screenResizingRef.current) return;
      const newW = Math.max(40, screenResizingRef.current.startW + ev.clientX - screenResizingRef.current.startX);
      if (screenResizingRef.current.isSticky) {
        setChannelNameWidth(newW);
      } else {
        setScreenColWidths(prev => ({ ...prev, [screenResizingRef.current!.col]: newW }));
      }
    }
    function onUp() {
      screenResizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    fetch("/api/blacklist").then(r => r.ok ? r.json() : []).then(setBlacklist).catch(() => {});
    load();
    loadCriteria();
    checkAndResumeScreening();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/influencers");
    const data: Influencer[] = await res.json();
    setList(data);
    const maxRunAt = data
      .flatMap(i => (i.screening_metrics ?? []).map(m => m.run_at))
      .filter(Boolean).sort().reverse()[0];
    if (maxRunAt) setLastListupAt(maxRunAt);
    setLoading(false);
  }

  async function loadCriteria() {
    const res = await fetch("/api/screening-criteria");
    if (!res.ok) return;
    const c: Criteria = await res.json();
    setCriteria(c);
    setCriteriaForm({
      min_followers:          c.min_followers          != null ? String(c.min_followers)          : "",
      min_1m_count:           c.min_1m_count           != null ? String(c.min_1m_count)           : "",
      min_views_per_follower: c.min_views_per_follower != null ? String(c.min_views_per_follower) : "",
      min_avg_views:          c.min_avg_views          != null ? String(c.min_avg_views)          : "",
      max_ad_ratio:           c.max_ad_ratio           != null ? String(c.max_ad_ratio)           : "",
    });
  }

  async function submitKwAnalysis() {
    if (!kwModal) return;
    const kwCount = kwForm.keywords.split(",").map(k => k.trim()).filter(Boolean).length;
    if (!kwForm.adDate || kwCount === 0) return;
    if (!isValidEntryDate(kwForm.adDate)) {
      toast("광고 날짜가 올바르지 않습니다. (2020-01-01 ~ 오늘 범위로 입력)", "error");
      return;
    }
    setKwRunning(true);
    const res = await fetch("/api/keyword-impact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metricsId: kwModal.metricsId, keywords: kwForm.keywords, adDate: kwForm.adDate }),
    });
    if (res.ok) {
      const data = await res.json();
      setList(prev => prev.map(inf => ({
        ...inf,
        screening_metrics: inf.screening_metrics.map(m =>
          m.id === kwModal.metricsId ? { ...m, ...data } : m
        ),
      })));
      toast("분석 완료!", "success");
      setKwModal(null);
    } else {
      const err = await res.json();
      toast(err.error ?? "오류가 발생했습니다.", "error");
    }
    setKwRunning(false);
  }

  async function saveCriteria() {
    if (!criteria) return;
    setSavingCriteria(true);
    const parse = (v: string) => v.trim() !== "" ? Number(v) : null;
    const res = await fetch("/api/screening-criteria", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: criteria.id,
        min_followers:          parse(criteriaForm.min_followers),
        min_1m_count:           parse(criteriaForm.min_1m_count),
        min_views_per_follower: parse(criteriaForm.min_views_per_follower),
        min_avg_views:          parse(criteriaForm.min_avg_views),
        max_ad_ratio:           parse(criteriaForm.max_ad_ratio),
      }),
    });
    if (res.ok) {
      setCriteria(await res.json());
      toast("통과 기준이 저장되었습니다.", "success");
      setShowCriteria(false);
    }
    setSavingCriteria(false);
  }

  async function checkAndResumeScreening() {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) return;
      const jobs: { id: string; type: string; status: string }[] = await res.json();
      const inProgress = jobs.find(j => j.type === "screening" && j.status === "running");
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
        await checkScreeningJob();
      }, 10_000);
    } catch { /* 무시 */ }
  }

  async function checkScreeningJob() {
    if (document.hidden) return; // 백그라운드 탭에선 /api/jobs 폴링 스킵(Vercel 호출 절감)
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
        await load();
        toast("스크리닝이 완료됐습니다. 결과가 업데이트됐습니다.", "success");
      } else if (cur?.status === "failed") {
        clearInterval(pollTimerRef.current!);
        clearInterval(elapsedTimerRef.current!);
        pollTimerRef.current = null;
        elapsedTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        toast(`스크리닝에 실패했습니다: ${cur.error ?? "알 수 없는 오류"}`, "error");
      }
    } catch {
      // 폴링 오류는 무시 (재시도)
    }
  }

  async function runScreening() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    setRunning(true);
    setShowTimeoutError(false);
    setElapsedSeconds(0);

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "screening", payload: {} }),
    });

    if (!res.ok) {
      setRunning(false);
      toast("스크리닝 실행에 실패했습니다.", "error");
      return;
    }

    const { job } = await res.json();
    runningJobIdRef.current = job.id;
    toast("스크리닝이 시작됐습니다. 완료 시 자동으로 업데이트됩니다.", "info");

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
      await checkScreeningJob();
    }, 10_000);
  }

  async function patchNotes(id: string, notes: string) {
    const res = await fetch(`/api/influencers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: notes || null }),
    });
    if (res.ok) {
      setList(prev => prev.map(i => i.id === id ? { ...i, notes: notes || null } : i));
    }
    setEditNotes(null);
  }

  async function patchScreeningName(id: string, name: string) {
    const res = await fetch(`/api/influencers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setList(prev => prev.map(i => i.id === id ? { ...i, name } : i));
    } else {
      toast("저장에 실패했습니다.", "error");
    }
    setEditScreeningName(null);
  }

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/influencers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setList(prev => prev.map(i => i.id === id ? { ...i, status } : i));
  }

  async function updateCategory(id: string, category: string) {
    await fetch(`/api/influencers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: category || null }),
    });
    setList(prev => prev.map(i => i.id === id ? { ...i, category: category || null } : i));
  }

  async function applyBulkStatus() {
    if (selected.size === 0) return;
    setApplying(true);
    await Promise.all([...selected].map(id =>
      fetch(`/api/influencers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: bulkStatus }),
      })
    ));
    const label = STATUS.find(s => s.value === bulkStatus)?.label ?? bulkStatus;
    setList(prev => prev.map(i => selected.has(i.id) ? { ...i, status: bulkStatus } : i));
    toast(`${selected.size}개 계정을 '${label}'로 변경했습니다.`, "success");
    setSelected(new Set());
    setApplying(false);
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    const count = selected.size;
    if (!confirm(`선택한 ${count}개 계정을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    await Promise.all([...selected].map(id => fetch(`/api/influencers/${id}`, { method: "DELETE" })));
    setList(prev => prev.filter(i => !selected.has(i.id)));
    toast(`${count}개 계정을 삭제했습니다.`, "success");
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
    const filteredIds = filtered.map(i => i.id);
    const allSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));
    if (allSelected) {
      setSelected(prev => { const s = new Set(prev); filteredIds.forEach(id => s.delete(id)); return s; });
    } else {
      setSelected(prev => new Set([...prev, ...filteredIds]));
    }
  }

  function downloadCSV() {
    const headers = [
      "채널명", "URL", "플랫폼", "팔로워 수", "알고리즘 계수", "100만뷰 개수",
      "총 평균 조회수", "총 평균 도달수", "댓글 비율", "광고 비율",
      "광고 평균 조회수", "광고 효율", "광고 최고 조회수", "광고 최고 게시물 URL",
      "검색어", "검색어 트렌드", "통과 기준", "상태",
    ];
    const rows = sorted.map(inf => {
      const m = latest(inf);
      const s = STATUS.find(o => o.value === inf.status);
      const adEff = (m?.ad_avg_play_count != null && m?.total_avg_play_count != null)
        ? ((m.ad_avg_play_count - m.total_avg_play_count) / 10000).toFixed(2)
        : "";
      const snapResult = (() => {
        const snap = m?.criteria_snapshot;
        if (!snap) return "";
        if (snap.result === "no_criteria") return "기준없음";
        return snap.result === "pass" ? "통과" : "탈락";
      })();
      return [
        inf.name, inf.url,
        platformLabel(inf.platform),
        m?.followers ?? "",
        m?.avg_views_per_follower?.toFixed(2) ?? "",
        m?.count_1m_view ?? "",
        m?.total_avg_play_count ?? "",
        m?.total_avg_view_count ?? "",
        m?.total_comment_ratio != null ? (m.total_comment_ratio * 100).toFixed(2) + "%" : "",
        (m?.total_posts && m?.ad_posts != null) ? ((m.ad_posts / m.total_posts) * 100).toFixed(1) + "%" : "",
        m?.ad_avg_play_count ?? "",
        adEff,
        m?.top_ad_play_count ?? "",
        m?.top_ad_post_url ?? "",
        m?.kw_keywords ?? "",
        m?.kw_impact != null ? m.kw_impact.toFixed(1) + "%" : "",
        snapResult,
        s?.label ?? inf.status,
      ];
    });
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `스크리닝_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      if (lines.length < 2) { alert("데이터가 없습니다. 헤더 포함 2줄 이상 필요합니다."); return; }
      const rows: CsvRow[] = lines.slice(1).map(line => {
        const cols = parseCsvLine(line);
        const statusVal = cols[3] || "pending";
        const validStatus = STATUS.some(s => s.value === statusVal) ? statusVal : "pending";
        const catVal = cols[4] || null;
        const validCat = catVal && CATEGORIES.some(c => c.value === catVal) ? catVal : null;
        return {
          name: cols[0] ?? "",
          url: cols[1] ?? "",
          platform: cols[2]?.toLowerCase() === "youtube" ? "youtube" : "instagram",
          status: validStatus,
          category: validCat,
        };
      }).filter(r => r.name && r.url);
      setCsvRows(rows);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  function downloadTemplate() {
    const csv = "인플루언서명,URL,플랫폼(instagram/youtube),상태(pending/pass/hold/reject),카테고리(A/B/C/D/기타)\n홍길동,https://www.instagram.com/hongkil/,instagram,pending,A\n김유정,https://www.youtube.com/@kimyujung/,youtube,pending,B";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "스크리닝_업로드_템플릿.csv";
    a.click();
  }

  async function uploadCsvRows() {
    if (csvRows.length === 0) return;
    setUploading(true);
    const res = await fetch("/api/influencers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(csvRows),
    });
    const resData = await res.json().catch(() => null);
    setUploading(false);
    if (!res.ok) { alert("업로드 실패: " + ((resData as { error?: string })?.error ?? "오류")); return; }
    const inserted = Array.isArray(resData) ? resData.length : 0;
    setCsvRows([]);
    setShowUpload(false);
    alert(`${inserted}개 업로드 완료`);
    load();
  }

  const filtered = list
    .filter(i => statusFilter === "all" || i.status === statusFilter)
    .filter(i => !searchName || i.name.toLowerCase().includes(searchName.toLowerCase()))
    .filter(i => filterPlatform === "all" || i.platform === filterPlatform);

  const filteredIds = filtered.map(i => i.id);
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id));
  const hasFilter = searchName !== "" || filterPlatform !== "all";

  function handleSort(col: string) {
    setSortDir(prev => sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  }

  const sorted = [...filtered].sort((a, b) => {
    if (!sortCol) {
      // 기본 정렬: 데이터가 수집된 채널을 먼저 노출 (그 안에서는 기존 순서 유지)
      const aHas = (a.screening_metrics ?? []).length > 0 ? 1 : 0;
      const bHas = (b.screening_metrics ?? []).length > 0 ? 1 : 0;
      return bHas - aHas;
    }
    const ma = latest(a);
    const mb = latest(b);
    let av: string | number = "", bv: string | number = "";
    switch (sortCol) {
      case "채널명": av = a.name.toLowerCase(); bv = b.name.toLowerCase(); break;
      case "플랫폼": av = a.platform; bv = b.platform; break;
      case "팔로워 수": av = ma?.followers ?? -1; bv = mb?.followers ?? -1; break;
      case "알고리즘 계수": av = ma?.avg_views_per_follower ?? -1; bv = mb?.avg_views_per_follower ?? -1; break;
      case "100만뷰 개수": av = ma?.count_1m_view ?? -1; bv = mb?.count_1m_view ?? -1; break;
      case "총 평균 조회수": av = ma?.total_avg_play_count ?? -1; bv = mb?.total_avg_play_count ?? -1; break;
      case "총 평균 도달수": av = ma?.total_avg_view_count ?? -1; bv = mb?.total_avg_view_count ?? -1; break;
      case "댓글 비율": av = ma?.total_comment_ratio ?? -1; bv = mb?.total_comment_ratio ?? -1; break;
      case "광고 비율": av = (ma?.total_posts && ma?.ad_posts != null) ? ma.ad_posts / ma.total_posts : -1; bv = (mb?.total_posts && mb?.ad_posts != null) ? mb.ad_posts / mb.total_posts : -1; break;
      case "광고 평균 조회수": av = ma?.ad_avg_play_count ?? -1; bv = mb?.ad_avg_play_count ?? -1; break;
      case "광고 효율": av = (ma?.ad_avg_play_count != null && ma?.total_avg_play_count != null) ? (ma.ad_avg_play_count - ma.total_avg_play_count) / 10000 : -1; bv = (mb?.ad_avg_play_count != null && mb?.total_avg_play_count != null) ? (mb.ad_avg_play_count - mb.total_avg_play_count) / 10000 : -1; break;
      case "광고 최고 조회수": av = ma?.top_ad_play_count ?? -1; bv = mb?.top_ad_play_count ?? -1; break;
      case "상태": av = a.status; bv = b.status; break;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  // 열 정의 툴팁 (인스타 / 유튜브)
  const COL_DEFS: Record<string, { ig?: string; yt?: string; both?: string }> = {
    "팔로워 수":        { ig: "인스타그램 팔로워 수 (followersCount)", yt: "유튜브 구독자 수 (channelSubscriberCount)" },
    "알고리즘 계수":    {
      ig: "팔로워 대비 평균 재생수\n= videoPlayCount 평균 ÷ followersCount\n\n[기준] BEST = 1↑ / GOOD = 0↑ / BAD = 음수\n알고리즘 파급력을 나타내는 지표",
      yt: "팔로워 대비 평균 재생수\n= 평균 viewCount ÷ 구독자 수\n\n[기준] BEST = 1↑ / GOOD = 0↑ / BAD = 음수",
    },
    "100만뷰 개수":     {
      ig: "최근 1개월 릴스 중 videoPlayCount ≥ 1,000,000 게시물 수\n※ 1개라도 있으면 O",
      yt: "최근 30일 Shorts 중 viewCount ≥ 1,000,000 개수\n※ 1개라도 있으면 O",
    },
    "총 평균 조회수":   {
      ig: "재생수(videoPlayCount) 평균\n= 인스타그램 앱 공개 조회수. 같은 사람이 여러 번 봐도 모두 카운트\n기준: 최근 1개월 릴스\n\n[기준] BEST = 10만↑ / GOOD = 7만↑ / BAD = 7만↓\n※ 가장 중요한 필수 검토 지표",
      yt: "viewCount 평균\n기준: 최근 30일 Shorts\n\n[기준] BEST = 10만↑ / GOOD = 7만↑ / BAD = 7만↓",
    },
    "총 평균 도달수":   {
      ig: "순조회수(videoViewCount) 평균\n= 중복 제거 시청자 수 (unique viewers), 한 사람이 10번 봐도 1로 집계\n※ 인스타그램 앱에서는 공개되지 않는 내부 지표",
      yt: "유튜브 미제공",
    },
    "댓글 비율":        {
      ig: "commentsCount / videoPlayCount × 100\n게시물별 비율의 평균 (방식 B)\n= #댓글 / #재생 (게시물마다 계산 후 평균)",
      yt: "commentsCount / viewCount × 100\n게시물별 비율의 평균 (방식 B)\n기준: 최근 30일 Shorts",
    },
    "광고 비율":        {
      ig: "광고 게시물(#광고) / 최근 1개월 총 릴스 × 100",
      yt: "광고 Shorts(#광고 #협찬 #AD #Sponsored) / 최근 30일 총 Shorts × 100",
    },
    "광고 평균 조회수": {
      ig: "최근 1개월 내 광고 릴스(#광고)의 videoPlayCount 평균",
      yt: "최근 30일 광고 Shorts(#광고 #협찬 #AD #Sponsored)의 viewCount 평균",
    },
    "광고 효율":        { both: "(광고 평균 재생수 − 일반 평균 재생수) ÷ 10,000\n양수 = 광고 게시물이 일반보다 더 퍼짐\n음수 = 광고 때 성과 하락" },
    "광고 최고 조회수": {
      ig: "최근 1개월 광고 릴스(#광고) 중 최고 videoPlayCount",
      yt: "최근 30일 광고 Shorts 중 최고 viewCount",
    },
    "검색어 트렌드":    { both: "광고 전후 네이버 검색량 변화율\n= (후 7일 평균 − 전 7일 평균) ÷ 전 7일 평균 × 100" },
  };

  function ColTooltip({ col }: { col: string }) {
    const def = COL_DEFS[col];
    if (!def) return null;
    return (
      <div className="hidden group-hover:block absolute top-full left-0 mt-1.5 z-[9999] bg-white border border-a-hairline rounded-[10px] px-3.5 py-3 shadow-[0_4px_16px_rgba(0,0,0,0.10)] min-w-[200px] max-w-[280px] pointer-events-none text-left">
        <p className="text-[11px] font-semibold text-a-ink mb-1.5">{col}</p>
        {def.both ? (
          <p className="text-[11px] text-a-ink-muted leading-relaxed whitespace-pre-line">{def.both}</p>
        ) : (
          <div className="space-y-2">
            {def.ig && (
              <div>
                <span className="text-[10px] font-semibold text-blue-500">인스타그램</span>
                <p className="text-[11px] text-a-ink-muted leading-relaxed whitespace-pre-line mt-0.5">{def.ig}</p>
              </div>
            )}
            {def.yt && (
              <div>
                <span className="text-[10px] font-semibold text-red-400">유튜브</span>
                <p className="text-[11px] text-a-ink-muted leading-relaxed whitespace-pre-line mt-0.5">{def.yt}</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // sortable + resizable TH helper
  function sortTH(col: string, right = false, center = false, stickyLeft?: number, stickyColW?: number, lastSticky = false) {
    const isSticky = stickyLeft !== undefined;
    const colW = stickyColW ?? screenColWidths[col];
    const active = sortCol === col;
    const hasDef = !!COL_DEFS[col];
    return (
      <th key={col} onClick={() => handleSort(col)}
        style={isSticky
          ? { left: stickyLeft, minWidth: colW, width: colW }
          : { minWidth: colW }}
        className={[
          "relative px-3 py-3 text-xs font-medium whitespace-nowrap cursor-pointer select-none transition-colors bg-white",
          center ? "text-center" : right ? "text-right" : "text-left",
          isSticky ? "sticky z-40" : "",
          lastSticky ? "shadow-[2px_0_5px_rgba(0,0,0,0.06)]" : "",
          active ? "text-a-ink" : "text-a-ink-muted hover:text-a-ink",
          hasDef ? "group" : "",
        ].join(" ")}>
        {col}<span className={`ml-1 ${active ? "text-a-blue" : "opacity-20"}`}>{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
        {hasDef && <ColTooltip col={col} />}
        <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-a-blue/30"
          onMouseDown={e => { e.stopPropagation(); startScreenResize(col, e, isSticky); }} />
      </th>
    );
  }

  // non-sortable resizable TH helper
  function staticTH(col: string, right = false, center = false) {
    const hasDef = !!COL_DEFS[col];
    return (
      <th key={col}
        style={{ minWidth: screenColWidths[col] }}
        className={[
          "relative px-3 py-3 text-xs font-medium text-a-ink-muted bg-white whitespace-nowrap select-none",
          center ? "text-center" : right ? "text-right" : "text-left",
          hasDef ? "group" : "",
        ].join(" ")}>
        {col}
        {hasDef && <ColTooltip col={col} />}
        <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-a-blue/30"
          onMouseDown={e => { e.stopPropagation(); startScreenResize(col, e); }} />
      </th>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-a-ink transition text-sm">←</Link>
          <span className="text-a-ink text-sm font-semibold tracking-tight">스크리닝</span>
          <span className="text-gray-400 text-xs">
            {hasFilter || statusFilter !== "all"
              ? `${filtered.length} / ${list.length}명`
              : `${list.length}명`}
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
          {lastListupAt && (
            <span className="text-xs text-a-ink-muted whitespace-nowrap">
              마지막 업데이트 <span className="font-medium text-a-ink">{formatTimestamp(lastListupAt)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setShowUpload(true)} className="btn-secondary">
            CSV 가져오기
          </button>
          <button onClick={() => setShowCriteria(true)} className="btn-secondary">기준 설정</button>
          {running && (
            <>
              <span className="text-xs text-a-ink-muted tabular-nums">{formatElapsed(elapsedSeconds)}</span>
              <button onClick={checkScreeningJob} className="btn-secondary">지금 확인</button>
            </>
          )}
          <button onClick={runScreening} disabled={running} className="btn-primary">
            {running ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                실행 중
              </span>
            ) : "스크리닝 실행"}
          </button>
        </div>
      </div>

      <div className="p-6">
        {/* 검색 + 유형 필터 카드 */}
        <div className="bg-white rounded-[14px] border border-a-hairline px-4 py-2.5 mb-3 flex items-center gap-3 flex-wrap">
          <input
            type="text"
            placeholder="채널명 검색"
            value={searchName}
            onChange={e => setSearchName(e.target.value)}
            className={`filter-input w-36 ${searchName ? "border-a-blue" : ""}`}
          />
          <select
            value={filterPlatform}
            onChange={e => setFilterPlatform(e.target.value)}
            className={`filter-select ${filterPlatform !== "all" ? "border-a-blue text-a-blue bg-blue-50" : ""}`}
          >
            <option value="all">전체 플랫폼</option>
            <option value="instagram">인스타</option>
            <option value="youtube">유튜브</option>
          </select>

          {hasFilter && (
            <button onClick={() => { setSearchName(""); setFilterPlatform("all"); }}
              className="btn-ghost py-1 ml-auto">초기화</button>
          )}
        </div>

        {/* 상태 탭 + 일괄 변경 */}
        <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
          {/* 상태 세그먼트 */}
          <div className="flex rounded-[10px] border border-a-hairline bg-a-parchment/60 p-0.5 gap-0.5">
            {["all", ...STATUS.map(s => s.value)].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`px-3.5 py-1.5 rounded-[7px] text-xs transition ${
                  statusFilter === s
                    ? "bg-white shadow-sm text-a-ink font-semibold"
                    : "text-a-ink-muted hover:text-a-ink"
                }`}>
                {s === "all" ? "전체" : STATUS.find(o => o.value === s)?.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-a-ink-muted">
              {selected.size > 0 ? `${selected.size}개 선택됨` : "체크하면 일괄 변경"}
            </span>
            <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
              className={`filter-select ${selected.size === 0 ? "opacity-40" : ""}`}>
              {STATUS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <button onClick={applyBulkStatus} disabled={applying || selected.size === 0} className="btn-primary">
              {applying ? "변경 중..." : "상태 변경"}
            </button>
            <button onClick={deleteSelected} disabled={deleting || selected.size === 0}
              className="text-xs px-3 py-1.5 rounded-full border border-red-300 text-red-500 hover:bg-red-50 disabled:opacity-40 transition">
              {deleting ? "삭제 중..." : "삭제"}
            </button>
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="btn-ghost py-1">해제</button>
            )}
            <div className="w-px h-4 bg-a-hairline" />
            <button onClick={downloadCSV} disabled={filtered.length === 0} className="btn-secondary">
              엑셀 다운로드
            </button>
          </div>
        </div>

        {/* 테이블 */}
        <div className="bg-white rounded-[18px] border border-a-hairline overflow-hidden">
          <div className="overflow-x-auto" style={{ transform: "rotateX(180deg)" }}>
          <div style={{ transform: "rotateX(180deg)" }}>
          {loading ? (
            <div className="p-8 text-center text-a-ink-muted text-sm">로딩 중...</div>
          ) : (
            <table className="text-sm">
              <thead className="sticky top-0 z-30">
                <tr className="border-b border-a-hairline">
                  <th style={{ left: 0, width: 44, minWidth: 44, maxWidth: 44 }}
                    className="pl-4 pr-2 py-3 sticky z-40 bg-white">
                    <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll}
                      className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                  </th>
                  {sortTH("채널명", false, false, 44, channelNameWidth, true)}
                  {sortTH("플랫폼")}
                  {sortTH("팔로워 수", true)}
                  {sortTH("알고리즘 계수", true)}
                  {sortTH("100만뷰 개수", true)}
                  {sortTH("총 평균 조회수", true)}
                  {sortTH("총 평균 도달수", true)}
                  {sortTH("댓글 비율", true)}
                  {sortTH("광고 비율", true)}
                  {sortTH("광고 평균 조회수", true)}
                  {sortTH("광고 효율", true)}
                  {sortTH("광고 최고 조회수", true)}
                  {staticTH("검색어")}
                  {staticTH("검색어 트렌드", true)}
                  {staticTH("통과 기준", false, true)}
                  {sortTH("상태", false, true)}
                  {staticTH("특이사항")}
                </tr>
              </thead>
              <tbody>
                {sorted.map(inf => {
                  const m = latest(inf);
                  const s = STATUS.find(o => o.value === inf.status);
                  const hasNoMetrics = (inf.screening_metrics ?? []).length === 0;
                  const isSelected = selected.has(inf.id);
                  const stickyCell = `sticky z-10 whitespace-nowrap ${isSelected ? "bg-blue-50" : "bg-white group-hover:bg-a-parchment"}`;
                  return (
                    <tr key={inf.id} className={`group border-b border-a-divider last:border-0 hover:bg-a-parchment/60 transition-colors ${isSelected ? "bg-blue-50/40" : ""}`}>
                      <td style={{ left: 0, width: 44, minWidth: 44, maxWidth: 44 }}
                        className={`pl-4 pr-2 py-4 ${stickyCell}`}>
                        <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(inf.id)}
                          className="w-3.5 h-3.5 accent-a-blue cursor-pointer" />
                      </td>
                      <td style={{ left: 44, width: channelNameWidth }}
                        className={`px-3 py-4 shadow-[2px_0_5px_rgba(0,0,0,0.06)] ${stickyCell}`}>
                        <div style={{ width: channelNameWidth - 24, overflow: 'hidden', whiteSpace: 'nowrap' }}>
                          {editScreeningName?.id === inf.id ? (
                            <input autoFocus value={editScreeningName.value}
                              onChange={e => setEditScreeningName(v => v ? { ...v, value: e.target.value } : null)}
                              onBlur={() => patchScreeningName(inf.id, editScreeningName.value)}
                              onKeyDown={e => { if (e.key === "Enter") patchScreeningName(inf.id, editScreeningName.value); if (e.key === "Escape") setEditScreeningName(null); }}
                              className="w-full text-sm font-medium bg-transparent border-b border-a-blue outline-none py-0.5" />
                          ) : (
                            <div className="flex items-center gap-1">
                              {(() => {
                                const handle = (s: string) => { try { const u = new URL(s); const p = u.pathname.split("/").filter(Boolean); return u.hostname.includes("youtube") ? (p.find(x => x.startsWith("@"))?.slice(1) ?? "") : (p[0] ?? ""); } catch { return ""; } };
                                const infHandle = handle(inf.url ?? "");
                                const bl = blacklist.find(b => { const bh = handle(b.url ?? ""); return bh && infHandle && bh.toLowerCase() === infHandle.toLowerCase(); });
                                return bl ? <span title={`블랙리스트: ${bl.reason}`} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-600 shrink-0 cursor-help">블랙</span> : null;
                              })()}
                              <a href={inf.url} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 font-medium hover:text-a-blue transition-colors group/link min-w-0">
                                <span className="truncate">{inf.name}</span>
                                <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="opacity-0 group-hover/link:opacity-50 flex-shrink-0 transition-opacity">
                                  <path d="M5.5 2.5H2.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                  <path d="M8.5 1.5h4m0 0v4m0-4L6 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </a>
                              <button onClick={() => setEditScreeningName({ id: inf.id, value: inf.name })}
                                className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="이름 수정">
                                <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                  <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                      <td style={{ minWidth: screenColWidths["플랫폼"] }} className="px-3 py-4 text-a-ink-muted text-xs whitespace-nowrap">
                        {platformLabel(inf.platform)}
                      </td>
                      <td style={{ minWidth: screenColWidths["팔로워 수"] }} className="px-3 py-4 text-right tabular-nums whitespace-nowrap">
                        {hasNoMetrics
                          ? <span className="text-[11px] bg-amber-50 text-amber-600 px-2 py-0.5 rounded-full font-medium">미수집</span>
                          : <span className="text-a-ink">{fmt(m?.followers)}</span>}
                      </td>
                      <td style={{ minWidth: screenColWidths["알고리즘 계수"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">
                        {m?.avg_views_per_follower?.toFixed(2) ?? "-"}
                      </td>
                      <td style={{ minWidth: screenColWidths["100만뷰 개수"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">
                        {m?.count_1m_view ?? "-"}
                      </td>
                      <td style={{ minWidth: screenColWidths["총 평균 조회수"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">{fmt(m?.total_avg_play_count)}</td>
                      <td style={{ minWidth: screenColWidths["총 평균 도달수"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">{fmt(m?.total_avg_view_count)}</td>
                      <td style={{ minWidth: screenColWidths["댓글 비율"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">{fmtRatio(m?.total_comment_ratio)}</td>
                      <td style={{ minWidth: screenColWidths["광고 비율"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">
                        {(m?.total_posts && m?.ad_posts != null) ? ((m.ad_posts / m.total_posts) * 100).toFixed(1) + "%" : "-"}
                      </td>
                      <td style={{ minWidth: screenColWidths["광고 평균 조회수"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">{fmt(m?.ad_avg_play_count)}</td>
                      <td style={{ minWidth: screenColWidths["광고 효율"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">
                        {(m?.ad_avg_play_count != null && m?.total_avg_play_count != null)
                          ? ((m.ad_avg_play_count - m.total_avg_play_count) / 10000).toFixed(2)
                          : "-"}
                      </td>
                      <td style={{ minWidth: screenColWidths["광고 최고 조회수"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">
                        {m?.top_ad_post_url
                          ? <a href={m.top_ad_post_url} target="_blank" rel="noreferrer"
                              className="hover:text-a-blue hover:underline transition-colors">
                              {fmt(m?.top_ad_play_count)}
                            </a>
                          : fmt(m?.top_ad_play_count)}
                      </td>
                      <td style={{ minWidth: screenColWidths["검색어"] }} className="px-3 py-4 whitespace-nowrap">
                        {inf.keyword
                          ? <span className="text-xs bg-a-parchment text-a-ink-muted px-2 py-0.5 rounded-full">#{inf.keyword}</span>
                          : <span className="text-a-ink-muted text-xs">-</span>}
                      </td>
                      <td style={{ minWidth: screenColWidths["검색어 트렌드"] }} className="px-3 py-4 text-right tabular-nums whitespace-nowrap">
                        {(() => {
                          if (!m?.kw_keywords) return <span className="text-a-ink-muted">-</span>;
                          if (m.kw_impact == null) return <span className="text-xs text-a-ink-muted">측정 불가</span>;
                          const pct = m.kw_impact;
                          const color = pct > 0 ? "text-green-600" : pct < 0 ? "text-red-500" : "text-a-ink-muted";
                          const arrow = pct > 0 ? " ↑" : pct < 0 ? " ↓" : "";
                          return (
                            <span className={`text-xs font-semibold ${color}`}>
                              {pct > 0 ? "+" : ""}{pct.toFixed(1)}%{arrow}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ minWidth: screenColWidths["통과 기준"] }} className="px-3 py-4 text-center whitespace-nowrap">
                        {(() => {
                          const snap = m?.criteria_snapshot;
                          if (!snap) return <span className="text-a-ink-muted">-</span>;
                          return (
                            <button onClick={() => setSnapshotModal(snap)}
                              className="text-xs text-a-blue hover:underline">
                              보기
                            </button>
                          );
                        })()}
                      </td>
                      <td style={{ minWidth: screenColWidths["상태"] }} className="px-3 py-4 text-center whitespace-nowrap">
                        <div className="inline-flex items-center relative">
                          <select value={inf.status} onChange={e => updateStatus(inf.id, e.target.value)}
                            className={`appearance-none pl-2.5 pr-5 py-1 rounded-full cursor-pointer border-0 outline-none text-xs font-medium ${s?.cls}`}>
                            {STATUS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                          <span className="pointer-events-none absolute right-1.5 text-[9px] opacity-50">▾</span>
                        </div>
                      </td>
                      <td style={{ minWidth: screenColWidths["특이사항"] }} className="px-3 py-3">
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
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={19} className="px-5 py-12 text-center">
                      {list.length === 0
                        ? <span className="text-a-ink-muted text-sm">인플루언서가 없습니다.</span>
                        : (
                          <div>
                            <p className="text-sm text-a-ink-muted mb-2">필터 조건에 맞는 결과가 없습니다.</p>
                            <button onClick={() => { setSearchName(""); setFilterPlatform("all"); setStatusFilter("all"); }}
                              className="text-xs text-a-blue hover:underline">필터 초기화</button>
                          </div>
                        )}
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

      {showTimeoutError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowTimeoutError(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[420px] p-7">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-semibold text-red-500 tracking-[0.1em] uppercase mb-1">시간 초과</p>
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">스크리닝 지연 안내</h2>
              </div>
              <button onClick={() => setShowTimeoutError(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <p className="text-sm text-a-ink-muted leading-relaxed mb-5">
              5분 내에 스크리닝이 완료되지 않았습니다.
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

      {kwModal && (() => {
        const kwCount = kwForm.keywords.split(",").map(k => k.trim()).filter(Boolean).length;
        const isValid = kwForm.adDate !== "" && kwCount > 0;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => !kwRunning && setKwModal(null)} />
            <div className="relative bg-white rounded-2xl shadow-xl w-[440px] p-7">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <p className="text-[10px] font-semibold text-a-blue tracking-[0.1em] uppercase mb-1">검색 트렌드 분석</p>
                  <h2 className="font-bold text-[18px] text-a-ink tracking-tight">{kwModal.infName}</h2>
                </div>
                <button onClick={() => setKwModal(null)} disabled={kwRunning}
                  className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink disabled:opacity-40">
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-a-ink block mb-1.5">광고 날짜</label>
                  <input type="date" value={kwForm.adDate} min={MIN_ENTRY_DATE} max={maxDateKST()}
                    onChange={e => setKwForm(p => ({ ...p, adDate: e.target.value }))}
                    className="filter-input w-full" />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-a-ink">검색어</label>
                    <span className={`text-[11px] ${kwCount > 20 ? "text-red-500" : "text-a-ink-muted"}`}>
                      {kwCount} / 20개
                    </span>
                  </div>
                  <textarea
                    value={kwForm.keywords}
                    onChange={e => setKwForm(p => ({ ...p, keywords: e.target.value }))}
                    placeholder="바닐라빈, 딸기주물럭, vanilla bean"
                    rows={3}
                    className="border border-a-hairline rounded-[8px] px-3 py-2 text-xs w-full focus:outline-none focus:border-a-blue transition resize-none"
                  />
                  <p className="text-[11px] text-a-ink-muted mt-1">콤마(,)로 구분, 최대 20개</p>
                </div>

                {kwForm.keywords && kwForm.adDate && (
                  <div className="rounded-[10px] bg-a-parchment px-4 py-3 text-[12px] text-a-ink-muted">
                    광고 날짜 <strong className="text-a-ink">{kwForm.adDate}</strong> 기준<br />
                    전 7일 ({new Date(new Date(kwForm.adDate).getTime() - 7*86400000).toISOString().slice(0,10)}) ~
                    후 7일 ({new Date(new Date(kwForm.adDate).getTime() + 7*86400000).toISOString().slice(0,10)}) 검색량 비교
                  </div>
                )}
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button onClick={() => setKwModal(null)} disabled={kwRunning}
                  className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment disabled:opacity-40 transition">
                  취소
                </button>
                <button onClick={submitKwAnalysis} disabled={!isValid || kwRunning || kwCount > 20}
                  className="text-xs px-4 py-2 rounded-full bg-a-blue text-white hover:bg-a-blue-hover disabled:opacity-40 transition">
                  {kwRunning ? "분석 중..." : "분석 실행"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showCriteria && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowCriteria(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[420px] p-7">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[10px] font-semibold text-a-blue tracking-[0.1em] uppercase mb-1">스크리닝</p>
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">통과 기준 설정</h2>
              </div>
              <button onClick={() => setShowCriteria(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <p className="text-xs text-a-ink-muted mb-5 leading-relaxed">
              아래 조건을 <strong className="text-a-ink font-semibold">모두 충족</strong>한 계정만 스크리닝 시 '통과'로 자동 분류됩니다. 비워두면 해당 조건은 무시됩니다.
            </p>
            <div className="space-y-2.5">
              {([
                { key: "min_followers",          label: "팔로워 수",    suffix: "이상" },
                { key: "min_1m_count",           label: "100만뷰 개수", suffix: "개 이상" },
                { key: "min_views_per_follower", label: "알고리즘 계수", suffix: "이상" },
                { key: "min_avg_views",          label: "총 평균 조회수", suffix: "이상" },
                { key: "max_ad_ratio",           label: "광고 비율",    suffix: "% 이하" },
              ] as { key: keyof CriteriaForm; label: string; suffix: string }[]).map(({ key, label, suffix }) => (
                <div key={key} className="rounded-[10px] bg-a-parchment px-4 py-3">
                  <p className="text-xs font-semibold text-a-ink mb-2">{label}</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={criteriaForm[key]}
                      onChange={e => setCriteriaForm(prev => ({ ...prev, [key]: e.target.value }))}
                      placeholder="비우면 조건 없음"
                      className="w-36 border border-a-hairline rounded-[6px] px-2.5 py-1.5 text-xs focus:outline-none focus:border-a-blue transition bg-white"
                    />
                    <span className="text-xs text-a-ink-muted">{suffix}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => setShowCriteria(false)}
                className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment transition">
                취소
              </button>
              <button onClick={saveCriteria} disabled={savingCriteria}
                className="text-xs px-4 py-2 rounded-full bg-a-blue text-white hover:bg-a-blue-hover disabled:opacity-40 transition">
                {savingCriteria ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      {snapshotModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setSnapshotModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[400px] p-7">
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-[10px] font-semibold text-a-blue tracking-[0.1em] uppercase mb-1">스크리닝 시점 기준</p>
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">통과 기준 상세</h2>
              </div>
              <button onClick={() => setSnapshotModal(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            {snapshotModal.result === "no_criteria" ? (
              <p className="text-sm text-a-ink-muted">스크리닝 당시 설정된 통과 기준이 없었습니다.</p>
            ) : (
              <>
                <div className={`mb-4 px-3 py-2 rounded-[8px] text-sm font-semibold ${
                  snapshotModal.result === "pass" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                }`}>
                  {snapshotModal.result === "pass" ? "✓ 통과" : "✗ 탈락"}
                </div>
                <div className="space-y-2">
                  {snapshotModal.details.map((d, i) => (
                    <div key={i} className={`rounded-[10px] px-4 py-3 ${d.passed ? "bg-green-50" : "bg-red-50"}`}>
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-xs font-semibold text-a-ink">{d.label}</p>
                        <span className={`text-xs font-bold ${d.passed ? "text-green-600" : "text-red-500"}`}>
                          {d.passed ? "✓" : "✗"}
                        </span>
                      </div>
                      <p className="text-[12px] text-a-ink-muted">
                        기준: {d.op} {d.threshold.toLocaleString()} · 실제: {d.value != null ? d.value.toLocaleString() : "-"}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {showUpload && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowUpload(false)}>
          <div className="bg-white rounded-[22px] p-6 w-[600px] max-h-[80vh] overflow-y-auto shadow-[0_8px_40px_rgba(0,0,0,0.12)]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <h2 className="font-semibold tracking-tight">CSV 일괄 업로드</h2>
              <button onClick={() => setShowUpload(false)} className="text-a-ink-muted hover:text-a-ink text-xl leading-none">×</button>
            </div>
            <p className="text-xs text-a-ink-muted mb-4">컬럼 순서: 인플루언서명, URL, 플랫폼, 상태, 카테고리</p>
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
                        <th className="px-3 py-1.5 text-left font-medium">인플루언서명</th>
                        <th className="px-3 py-1.5 text-left font-medium">URL</th>
                        <th className="px-3 py-1.5 text-left font-medium">플랫폼</th>
                        <th className="px-3 py-1.5 text-left font-medium">상태</th>
                        <th className="px-3 py-1.5 text-left font-medium">카테고리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} className="border-b border-a-divider last:border-0">
                          <td className="px-3 py-1.5 text-a-ink">{r.name}</td>
                          <td className="px-3 py-1.5 text-a-blue max-w-[120px] truncate text-xs">{r.url}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted text-xs">{r.platform}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted text-xs">{r.status}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted text-xs">{r.category ?? "-"}</td>
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

      {showHelp && (
        <HelpModal title="스크리닝 사용 안내" onClose={() => setShowHelp(false)}>
          <HelpSection title="이 탭에서 하는 일">
            <p className="text-a-ink-muted leading-relaxed">발굴된 계정의 성과 지표(팔로워, 조회수, 광고 비율 등)를 수집해 협찬 후보를 선정합니다.</p>
          </HelpSection>
          <HelpSection title="버튼 설명">
            <HelpItem label="스크리닝 실행 —">아직 지표가 없는 계정만 대상으로 Apify를 통해 데이터를 수집합니다(이미 수집된 계정은 건너뜀). 백그라운드 작업으로 처리되며 완료 시 결과가 자동 반영됩니다. 5분이 넘으면 지연 안내가 뜨지만 작업은 계속 진행됩니다.</HelpItem>
            <HelpItem label="기준 설정 —">통과 자동 분류 조건(팔로워·100만뷰 개수·알고리즘 계수·총 평균 조회수·광고 비율)을 정합니다. 설정한 조건을 모두 충족한 계정만 스크리닝 시 '통과'로 자동 분류되며, 비워둔 조건은 무시됩니다. (표의 '통과 기준' 열에서 '보기'를 누르면 항목별 충족 여부 확인)</HelpItem>
            <HelpItem label="CSV 가져오기 —">인플루언서명·URL·플랫폼·상태·카테고리 컬럼의 CSV로 계정을 일괄 등록합니다. (템플릿 다운로드 제공)</HelpItem>
            <HelpItem label="엑셀 다운로드 —">현재 목록의 전체 스크리닝 지표를 CSV로 내려받습니다.</HelpItem>
          </HelpSection>
          <HelpSection title="상태 변경 · 편집">
            <HelpItem label="개별 변경 —">테이블 맨 오른쪽 드롭다운에서 각 계정의 상태를 직접 바꿀 수 있습니다.</HelpItem>
            <HelpItem label="일괄 변경 —">체크박스로 여러 계정을 선택한 뒤 오른쪽 상단 드롭다운에서 상태를 일괄 변경합니다.</HelpItem>
            <HelpItem label="삭제 —">체크한 계정을 일괄 삭제합니다. (되돌릴 수 없으니 주의)</HelpItem>
            <HelpItem label="채널명·특이사항 —">셀을 클릭하면 바로 수정·저장할 수 있습니다.</HelpItem>
          </HelpSection>
          <HelpSection title="검색어 트렌드">
            <p className="text-a-ink-muted leading-relaxed">'검색어 트렌드' 열은 광고 전후 네이버 검색량 변화율(후 7일 평균 대비 전 7일 평균)로, 광고 화제성을 가늠하는 지표입니다.</p>
          </HelpSection>
          <HelpSection title="필터 및 정렬">
            <HelpItem label="상태 탭 —">전체 / 대기중 / 통과 / 보류 / 탈락 중 원하는 상태만 볼 수 있습니다.</HelpItem>
            <HelpItem label="채널명 검색 —">이름으로 계정을 검색합니다.</HelpItem>
            <HelpItem label="플랫폼 필터 —">인스타그램 / 유튜브만 볼 수 있습니다.</HelpItem>
            <HelpItem label="컬럼 정렬 —">헤더를 클릭하면 해당 지표 기준으로 오름/내림차순 정렬됩니다.</HelpItem>
          </HelpSection>
        </HelpModal>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
