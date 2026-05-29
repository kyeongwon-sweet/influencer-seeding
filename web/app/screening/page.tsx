"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";

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
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmt(v: number | null | undefined) {
  return v == null ? "-" : v.toLocaleString();
}

function fmtRatio(v: number | null | undefined) {
  return v == null ? "-" : (v * 100).toFixed(2) + "%";
}

function latest(inf: Influencer): Metrics | null {
  return (inf.screening_metrics ?? []).sort(
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
  const [kwRunning, setKwRunning] = useState(false);
  const [lastListupAt, setLastListupAt] = useState<string | null>(null);
  const [showTimeoutError, setShowTimeoutError] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const runningJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // column widths for drag-resize
  const [channelNameWidth, setChannelNameWidth] = useState(160);
  const [editScreeningName, setEditScreeningName] = useState<{ id: string; value: string } | null>(null);
  const [screenColWidths, setScreenColWidths] = useState<Record<string, number>>({
    "플랫폼": 80, "팔로워 수": 100, "알고리즘 계수": 110, "100만뷰 개수": 110,
    "총 평균 조회수": 120, "총 평균 도달수": 120, "댓글 비율": 90, "광고 비율": 90,
    "광고 평균 조회수": 120, "광고 효율": 90, "광고 최고 조회수": 120,
    "광고 최고 게시물 URL": 120, "검색어": 140, "검색어 트렌드": 110,
    "통과 기준": 90, "카테고리": 90, "상태": 90,
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
      "검색어", "검색어 트렌드", "통과 기준", "카테고리", "상태",
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
        inf.platform === "instagram" ? "인스타" : "유튜브",
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
        inf.category ?? "",
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
    if (!sortCol) return 0;
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
      case "카테고리": av = a.category ?? ""; bv = b.category ?? ""; break;
      case "상태": av = a.status; bv = b.status; break;
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  // 열 정의 툴팁 (인스타 / 유튜브)
  const COL_DEFS: Record<string, { ig?: string; yt?: string; both?: string }> = {
    "팔로워 수":        { both: "계정 팔로워(구독자) 수" },
    "알고리즘 계수":    { ig: "평균 재생수 ÷ 팔로워 수", yt: "평균 재생수 ÷ 구독자 수" },
    "100만뷰 개수":     { ig: "최근 1개월 릴스 중 재생수 ≥ 1,000,000 게시물 수", yt: "최근 30일 Shorts 중 조회수 ≥ 1,000,000 개수" },
    "총 평균 조회수":   { ig: "videoPlayCount 평균\n(같은 사람이 여러 번 재생해도 모두 카운트)", yt: "viewCount 평균" },
    "총 평균 도달수":   { ig: "videoViewCount 평균\n(중복 제거 시청자 수, 1인=1)", yt: "유튜브 미제공" },
    "댓글 비율":        { ig: "commentsCount / videoPlayCount × 100\n게시물별 비율의 평균", yt: "commentsCount / viewCount × 100\n게시물별 비율의 평균" },
    "광고 비율":        { ig: "광고 게시물(#광고) / 총 게시물 × 100", yt: "광고 게시물(#광고 #협찬 #AD #Sponsored) / 총 게시물 × 100" },
    "광고 평균 조회수": { ig: "광고 릴스(#광고)의 평균 재생수", yt: "광고 Shorts의 평균 viewCount" },
    "광고 효율":        { both: "(광고 평균 재생수 − 일반 평균 재생수) ÷ 10,000\n양수 = 광고 게시물이 일반보다 더 많이 퍼짐" },
    "광고 최고 조회수": { ig: "광고 릴스(#광고) 중 최고 재생수", yt: "최근 30일 광고 Shorts 중 최고 viewCount" },
    "검색어 트렌드":    { both: "광고 전후 네이버 검색량 변화율\n(후 7일 평균 − 전 7일 평균) ÷ 전 7일 평균 × 100" },
  };

  function ColTooltip({ col }: { col: string }) {
    const def = COL_DEFS[col];
    if (!def) return null;
    return (
      <div className="hidden group-hover:block absolute top-full left-0 mt-1.5 z-[9999] bg-white border border-a-hairline rounded-[10px] px-3.5 py-3 shadow-[0_4px_16px_rgba(0,0,0,0.10)] min-w-[200px] max-w-[280px] pointer-events-none">
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
              마지막 스크리닝 <span className="font-medium text-a-ink">{formatTimestamp(lastListupAt)}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
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
        <div className="bg-white rounded-[18px] border border-a-hairline">
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
                  {staticTH("광고 최고 게시물 URL")}
                  {staticTH("검색어")}
                  {staticTH("검색어 트렌드", true)}
                  {staticTH("통과 기준", false, true)}
                  {(() => {
                    const col = "카테고리";
                    const active = sortCol === col;
                    return (
                      <th key={col} onClick={() => handleSort(col)}
                        style={{ minWidth: screenColWidths[col] }}
                        className={[
                          "relative px-3 py-3 text-xs font-medium whitespace-nowrap cursor-pointer select-none transition-colors bg-white text-center group",
                          active ? "text-a-ink" : "text-a-ink-muted hover:text-a-ink",
                        ].join(" ")}>
                        {col}<span className={`ml-1 ${active ? "text-a-blue" : "opacity-20"}`}>{active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}</span>
                        <div className="hidden group-hover:flex flex-col absolute top-full left-0 mt-0.5 z-50 bg-white border border-a-hairline rounded-[10px] shadow-lg px-3 py-2 text-left whitespace-nowrap">
                          {CATEGORIES.map(c => (
                            <div key={c.value} className="flex items-center gap-2 py-0.5">
                              <span className="text-[11px] font-semibold text-a-ink w-6">{c.value}</span>
                              <span className="text-[11px] text-a-ink-muted">{c.desc}</span>
                            </div>
                          ))}
                        </div>
                        <div className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-a-blue/30"
                          onMouseDown={e => { e.stopPropagation(); startScreenResize(col, e); }} />
                      </th>
                    );
                  })()}
                  {sortTH("상태", false, true)}
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
                        {inf.platform === "instagram" ? "인스타" : "유튜브"}
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
                      <td style={{ minWidth: screenColWidths["광고 최고 조회수"] }} className="px-3 py-4 text-right tabular-nums text-a-ink whitespace-nowrap font-numeric">{fmt(m?.top_ad_play_count)}</td>
                      <td style={{ minWidth: screenColWidths["광고 최고 게시물 URL"] }} className="px-3 py-4 whitespace-nowrap">
                        {m?.top_ad_post_url
                          ? <a href={m.top_ad_post_url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-a-blue hover:underline">
                              <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                                <path d="M5.5 2.5H2.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M8.5 1.5h4m0 0v4m0-4L6 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              링크
                            </a>
                          : <span className="text-a-ink-muted">-</span>}
                      </td>
                      <td style={{ minWidth: screenColWidths["검색어"] }} className="px-3 py-4 whitespace-nowrap">
                        {m ? (
                          m.kw_keywords
                            ? <button
                                onClick={() => { setKwModal({ metricsId: m.id, infName: inf.name }); setKwForm({ keywords: m.kw_keywords!, adDate: m.kw_ad_date ?? "" }); }}
                                className="text-xs text-a-ink hover:text-a-blue transition-colors">
                                {m.kw_keywords}
                              </button>
                            : <button
                                onClick={() => { setKwModal({ metricsId: m.id, infName: inf.name }); setKwForm({ keywords: "", adDate: "" }); }}
                                className="text-xs text-a-blue hover:underline whitespace-nowrap">
                                검색어 입력
                              </button>
                        ) : <span className="text-a-ink-muted">-</span>}
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
                      <td style={{ minWidth: screenColWidths["카테고리"] }} className="px-3 py-4 text-center whitespace-nowrap">
                        {(() => {
                          const cat = CATEGORIES.find(c => c.value === inf.category);
                          const catCls = cat?.cls ?? "bg-a-divider text-a-ink-muted";
                          return (
                            <div className="inline-flex items-center relative">
                              <select value={inf.category ?? ""} onChange={e => updateCategory(inf.id, e.target.value)}
                                className={`appearance-none pl-2.5 pr-5 py-1 rounded-full cursor-pointer border-0 outline-none text-xs font-medium ${catCls}`}>
                                <option value="">-</option>
                                {CATEGORIES.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}
                              </select>
                              <span className="pointer-events-none absolute right-1.5 text-[9px] opacity-50">▾</span>
                            </div>
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
                  <input type="date" value={kwForm.adDate}
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

      {showHelp && (
        <HelpModal title="스크리닝 사용 안내" onClose={() => setShowHelp(false)}>
          <HelpSection title="이 탭에서 하는 일">
            <p className="text-a-ink-muted leading-relaxed">발굴된 계정의 성과 지표(팔로워, 조회수, 광고 비율 등)를 수집해 협찬 후보를 선정합니다.</p>
          </HelpSection>
          <HelpSection title="버튼 설명">
            <HelpItem label="스크리닝 실행 —">아직 지표가 없는 계정만 대상으로 Apify를 통해 데이터를 수집합니다. 이미 수집된 계정은 건너뜁니다.</HelpItem>
          </HelpSection>
          <HelpSection title="상태 변경">
            <HelpItem label="개별 변경 —">테이블 맨 오른쪽 드롭다운에서 각 계정의 상태를 직접 바꿀 수 있습니다.</HelpItem>
            <HelpItem label="일괄 변경 —">체크박스로 여러 계정을 선택한 뒤 오른쪽 상단 드롭다운에서 상태를 일괄 변경합니다.</HelpItem>
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
