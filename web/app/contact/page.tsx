"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import DOMPurify from "dompurify";
import { useToast, ToastContainer } from "@/lib/useToast";
import { platformLabel } from "@/lib/platform";

// ─── Types ────────────────────────────────────────────────────────────────────

type Metrics = {
  id: string;
  followers: number | null;
  avg_views_per_follower: number | null;
  count_1m_view: number | null;
  total_avg_play_count: number | null;
  total_avg_view_count: number | null;
  total_comment_ratio: number | null;
  ad_posts: number | null;
  total_posts: number | null;
  ad_avg_play_count: number | null;
  top_ad_play_count: number | null;
  top_ad_post_url: string | null;
  kw_keywords: string | null;
  kw_impact: number | null;
  kw_before: number | null;
  kw_after: number | null;
  kw_ad_date: string | null;
};

type Influencer = {
  id: string;
  name: string;
  url: string;
  platform: string;
  status: string;
  keyword?: string;
  sample_post_url?: string;
  post_uploaded_at?: string;
  notes?: string | null;
  screening_metrics: Metrics[];
};

type TrendPoint = {
  date: string;
  keywordAbsolute: number;
  larasweetAbsolute: number;
};

type Template = {
  id: string;
  name: string;
  content: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTimestamp(ts: string): string {
  const d = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000); // KST 고정
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

function fmt(v: number | null | undefined) {
  return v == null ? "-" : v.toLocaleString();
}

function fmtSearch(v: number) {
  return Math.round(v).toLocaleString();
}

function fmtPct(v: number | null | undefined) {
  return v == null ? "-" : (v * 100).toFixed(1) + "%";
}

function getMetrics(inf: Influencer): Metrics | null {
  return inf.screening_metrics?.[0] ?? null;
}

// ─── Trend Chart ─────────────────────────────────────────────────────────────

function TrendChart({ data, selectedDate, onSelect }: {
  data: TrendPoint[];
  selectedDate: string | null;
  onSelect: (date: string) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (data.length === 0) return null;

  const W = 900, H = 200;
  const PAD = { top: 16, bottom: 32, left: 52, right: 12 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxVal = Math.max(...data.map(d => d.keywordAbsolute), 1);

  const xi = (i: number) => PAD.left + (i / (data.length - 1)) * innerW;
  const yv = (v: number) => PAD.top + innerH - Math.min(v / maxVal, 1) * innerH;

  const kwPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xi(i).toFixed(1)},${yv(d.keywordAbsolute).toFixed(1)}`).join(" ");
  const lsPath = data.map((d, i) => `${i === 0 ? "M" : "L"}${xi(i).toFixed(1)},${yv(d.larasweetAbsolute).toFixed(1)}`).join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => ({ r, v: Math.round(r * maxVal) }));

  const selIdx = selectedDate ? data.findIndex(d => d.date === selectedDate) : -1;

  // One label per month — skip labels too close to the y-axis or previous label
  const monthLabels: { i: number; label: string }[] = [];
  let lastMonth = "";
  let lastLabelX = -100;
  const MIN_LABEL_GAP = 44; // 최소 레이블 간격 (px)
  data.forEach((d, i) => {
    const m = d.date.slice(0, 7);
    if (m !== lastMonth) {
      const x = xi(i);
      if (x > PAD.left + 35 && x - lastLabelX >= MIN_LABEL_GAP) {
        monthLabels.push({ i, label: d.date.slice(5, 7) + "월" });
        lastLabelX = x;
      }
      lastMonth = m;
    }
  });

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relX = (e.clientX - rect.left) / rect.width * W;
    const idx = Math.round((relX - PAD.left) / innerW * (data.length - 1));
    setHoverIdx(Math.max(0, Math.min(data.length - 1, idx)));
  }

  const hov = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full cursor-crosshair"
        style={{ display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIdx(null)}
        onClick={() => hoverIdx !== null && onSelect(data[hoverIdx].date)}
      >
        {/* Grid lines */}
        {yTicks.map(({ v }) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yv(v)} y2={yv(v)} stroke="#e5e7eb" strokeWidth="0.8" />
            {v !== 0 && (
              <text x={PAD.left - 4} y={yv(v) + 4} textAnchor="end" fontSize="10" fill="#9ca3af">{v.toLocaleString()}</text>
            )}
          </g>
        ))}

        {/* 라라스윗 line (dashed, grey) */}
        <path d={lsPath} stroke="#d1d5db" strokeWidth="1" fill="none" strokeDasharray="3 2" />

        {/* Keyword line */}
        <path d={kwPath} stroke="#3b82f6" strokeWidth="1.5" fill="none" />

        {/* Month labels */}
        {monthLabels.map(({ i, label }) => (
          <text key={i} x={xi(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#9ca3af">{label}</text>
        ))}

        {/* Selected date line */}
        {selIdx >= 0 && (
          <line x1={xi(selIdx)} x2={xi(selIdx)} y1={PAD.top} y2={H - PAD.bottom}
            stroke="#3b82f6" strokeWidth="1.5" strokeDasharray="3 2" />
        )}

        {/* Hover indicator */}
        {hoverIdx !== null && (
          <>
            <line x1={xi(hoverIdx)} x2={xi(hoverIdx)} y1={PAD.top} y2={H - PAD.bottom}
              stroke="#6b7280" strokeWidth="0.75" />
            <circle cx={xi(hoverIdx)} cy={yv(data[hoverIdx].keywordAbsolute)} r="3" fill="#3b82f6" />
          </>
        )}
      </svg>

      {/* Hover tooltip — follows indicator: right side when on left half, left side when on right half */}
      {hov && hoverIdx !== null && (() => {
        const pct = (xi(hoverIdx) / W * 100).toFixed(1);
        const isRight = hoverIdx >= data.length / 2;
        return (
          <div
            className="absolute top-1 bg-black/80 text-white rounded-[8px] px-3 py-2 text-[11px] pointer-events-none z-10 whitespace-nowrap"
            style={isRight
              ? { right: `${(100 - xi(hoverIdx) / W * 100).toFixed(1)}%`, transform: "translateX(-8px)" }
              : { left: pct + "%", transform: "translateX(8px)" }
            }
          >
            <p className="font-medium mb-0.5">{hov.date}</p>
            <p>검색량: <span className="font-semibold text-blue-300">{fmtSearch(hov.keywordAbsolute)}</span></p>
            <p className="text-gray-400">라라스윗: {fmtSearch(hov.larasweetAbsolute)}</p>
            <p className="text-gray-500 mt-1 text-[10px]">클릭하여 날짜 선택</p>
          </div>
        );
      })()}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 px-1">
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-0.5 bg-blue-500 rounded" />
          <span className="text-[11px] text-a-ink-muted">키워드</span>
        </div>
        <div className="flex items-center gap-1.5">
          <svg width="20" height="4" viewBox="0 0 20 4"><line x1="0" y1="2" x2="20" y2="2" stroke="#d1d5db" strokeWidth="1.5" strokeDasharray="3 2" /></svg>
          <span className="text-[11px] text-a-ink-muted">라라스윗</span>
        </div>
      </div>
    </div>
  );
}

// ─── Influencer Name + Hover Tooltip ─────────────────────────────────────────

function InfluencerName({ inf }: { inf: Influencer }) {
  const m = getMetrics(inf);
  const adRatio = (m?.total_posts && m.ad_posts != null)
    ? (m.ad_posts / m.total_posts * 100).toFixed(1) + "%"
    : "-";
  const adEff = (m?.ad_avg_play_count != null && m.total_avg_play_count != null)
    ? ((m.ad_avg_play_count - m.total_avg_play_count) / 10000).toFixed(2)
    : "-";

  return (
    <div className="relative group inline-block">
      <a href={inf.url} target="_blank" rel="noreferrer"
        className="font-medium hover:text-a-blue transition text-sm">{inf.name}</a>

      {m && (
        <div className="absolute bottom-full left-0 mb-2 z-[9999] w-60 bg-gray-900 text-white rounded-[10px] p-3 shadow-xl text-[11px] pointer-events-none hidden group-hover:block">
          <p className="font-semibold text-sm mb-2 truncate">{inf.name}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            <span className="text-gray-400">팔로워</span><span className="text-right">{fmt(m.followers)}</span>
            <span className="text-gray-400">알고리즘 계수</span><span className="text-right">{m.avg_views_per_follower?.toFixed(2) ?? "-"}</span>
            <span className="text-gray-400">100만뷰</span><span className="text-right">{m.count_1m_view ?? "-"}개</span>
            <span className="text-gray-400">평균 조회수</span><span className="text-right">{fmt(m.total_avg_play_count)}</span>
            <span className="text-gray-400">평균 도달수</span><span className="text-right">{fmt(m.total_avg_view_count)}</span>
            <span className="text-gray-400">댓글 비율</span><span className="text-right">{fmtPct(m.total_comment_ratio)}</span>
            <span className="text-gray-400">광고 비율</span><span className="text-right">{adRatio}</span>
            <span className="text-gray-400">광고 평균 조회수</span><span className="text-right">{fmt(m.ad_avg_play_count)}</span>
            <span className="text-gray-400">광고 효율</span><span className="text-right">{adEff}</span>
            <span className="text-gray-400">광고 최고 조회수</span><span className="text-right">{fmt(m.top_ad_play_count)}</span>
            <span className="text-gray-400">검색어</span><span className="text-right truncate">{m.kw_keywords ?? "-"}</span>
            <span className="text-gray-400">광고 전 검색량</span>
            <span className="text-right">{m.kw_before != null ? m.kw_before.toLocaleString() + "건" : "-"}</span>
            <span className="text-gray-400">광고 후 검색량</span>
            <span className={`text-right ${m.kw_impact != null ? (m.kw_impact > 0 ? "text-green-400" : "text-red-400") : ""}`}>
              {m.kw_after != null ? m.kw_after.toLocaleString() + "건" : "-"}
              {m.kw_impact != null && (
                <span className="ml-1 text-[10px]">({m.kw_impact > 0 ? "+" : ""}{m.kw_impact.toFixed(1)}%)</span>
              )}
            </span>
          </div>
          {m.top_ad_post_url && (
            <p className="mt-2 pt-2 border-t border-gray-700 text-gray-400 text-[10px] truncate">
              광고 최고: {m.top_ad_post_url}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ContactPage() {
  const { toasts, show: toast } = useToast();

  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [kwOptions, setKwOptions] = useState<string[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [trendData, setTrendData] = useState<TrendPoint[]>([]);
  const [lastScreeningAt, setLastScreeningAt] = useState<string | null>(null);

  const [loadingInf, setLoadingInf] = useState(true);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [trendElapsed, setTrendElapsed] = useState(0);
  const trendTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [trendError, setTrendError] = useState<string | null>(null);
  const [selectedKeyword, setSelectedKeyword] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Contact modal
  const [contactModal, setContactModal] = useState<Influencer | null>(null);
  const [contactEmail, setContactEmail] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [contactText, setContactText] = useState("");

  // Template manager modal
  const [showTemplates, setShowTemplates] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [editForm, setEditForm] = useState({ name: "", content: "" });
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templatePreview, setTemplatePreview] = useState(false);
  const templateTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [editContactName, setEditContactName] = useState<{ id: string; value: string } | null>(null);
  const [editNotes, setEditNotes] = useState<{ id: string; value: string } | null>(null);

  function sanitizeHtml(html: string): string {
    // 정규식 방식은 <img onerror>·<svg> 등으로 우회 가능 → DOMPurify로 안전한 태그만 허용(스크립트/이벤트핸들러/javascript: 제거).
    // 템플릿에 표(table) 등 정상 HTML이 들어가므로 전체 이스케이프 대신 화이트리스트 새니타이즈 사용.
    if (typeof window === "undefined") return ""; // 미리보기는 클라이언트에서만 렌더(SSR 스킵)
    return DOMPurify.sanitize(html);
  }

  useEffect(() => {
    loadInfluencers();
    loadKeywords();
    loadTemplates();
    loadLastScreeningAt();
    return () => { if (trendTimerRef.current) clearInterval(trendTimerRef.current); };
  }, []);

  async function loadInfluencers() {
    setLoadingInf(true);
    const res = await fetch("/api/influencers");
    const all: Influencer[] = await res.json();
    const passed = all.filter(i => i.status === "pass");
    setInfluencers(passed);
    // Unique keywords from influencers
    const infKws = [...new Set(passed.map(i => i.keyword).filter(Boolean) as string[])];
    setKwOptions(prev => [...new Set([...prev, ...infKws])]);
    setLoadingInf(false);
  }

  async function loadKeywords() {
    const res = await fetch("/api/keywords");
    const data: { keyword: string }[] = await res.json();
    const kws = data.map(k => k.keyword);
    setKwOptions(prev => [...new Set([...kws, ...prev])]);
  }

  async function loadTemplates() {
    const res = await fetch("/api/contact-templates");
    setTemplates(await res.json());
  }

  async function loadLastScreeningAt() {
    const res = await fetch("/api/jobs");
    const jobs: { type: string; status: string; updated_at: string }[] = await res.json();
    const done = jobs.find(j => j.type === "screening" && j.status === "done");
    if (done) setLastScreeningAt(done.updated_at);
  }

  async function fetchTrend() {
    if (!selectedKeyword) return;
    setLoadingTrend(true);
    setTrendError(null);
    setTrendData([]);
    setTrendElapsed(0);
    if (trendTimerRef.current) clearInterval(trendTimerRef.current);
    trendTimerRef.current = setInterval(() => setTrendElapsed(s => s + 1), 1000);
    try {
      const endDate = new Date().toISOString().slice(0, 10);
      const startDate = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
      const res = await fetch("/api/naver-trends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keyword: selectedKeyword, startDate, endDate }),
      });
      if (res.status === 503) {
        setTrendError("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 설정되지 않았습니다. Vercel 환경변수를 확인하세요.");
      } else if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        setTrendError((e as { error?: string }).error ?? "트렌드 데이터를 불러오는 데 실패했습니다.");
      } else {
        const { dates } = await res.json();
        setTrendData(dates);
      }
    } finally {
      if (trendTimerRef.current) { clearInterval(trendTimerRef.current); trendTimerRef.current = null; }
      setLoadingTrend(false);
    }
  }

  // ── Contact modal ──────────────────────────────────────────────────────────

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

  async function patchContactName(id: string, name: string) {
    const res = await fetch(`/api/influencers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setInfluencers(prev => prev.map(i => i.id === id ? { ...i, name } : i));
    }
    setEditContactName(null);
  }

  function openContact(inf: Influencer) {
    setContactModal(inf);
    setContactEmail("");
    const first = templates[0];
    if (first) {
      setSelectedTemplateId(first.id);
      setContactText(first.content.replace(/\{name\}/g, inf.name));
    } else {
      setSelectedTemplateId("");
      setContactText("");
    }
  }

  function handleTemplateSelect(id: string) {
    setSelectedTemplateId(id);
    const tpl = templates.find(t => t.id === id);
    if (tpl && contactModal) setContactText(tpl.content.replace(/\{name\}/g, contactModal.name));
  }

  function handleGmail() {
    if (!contactModal || !contactEmail) return;
    const su = encodeURIComponent(`라라스윗 협찬 제안 - ${contactModal.name}님께`);
    const body = encodeURIComponent(contactText);
    const to = encodeURIComponent(contactEmail);
    window.open(`https://mail.google.com/mail/?view=cm&to=${to}&su=${su}&body=${body}`, "_blank");
  }

  function handleDM() {
    if (!contactModal) return;
    window.open(contactModal.url, "_blank");
  }

  // ── Template CRUD ──────────────────────────────────────────────────────────

  function startEdit(tpl: Template) {
    setEditingTemplate(tpl);
    setEditForm({ name: tpl.name, content: tpl.content });
  }

  function startNew() {
    setEditingTemplate({ id: "", name: "", content: "" });
    setEditForm({ name: "", content: "" });
    setTemplatePreview(false);
  }

  const TIMELINE_TABLE_HTML = `
<table style="border-collapse:collapse;width:100%;font-size:13px;margin:12px 0">
<thead>
<tr style="background:#f8f0ff">
<th style="border:1px solid #d4b8f0;padding:8px 12px;text-align:center;white-space:nowrap">단계</th>
<th style="border:1px solid #d4b8f0;padding:8px 12px;text-align:left">내용</th>
<th style="border:1px solid #d4b8f0;padding:8px 12px;text-align:center;white-space:nowrap">일정</th>
</tr>
</thead>
<tbody>
<tr><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">1</td><td style="border:1px solid #e0d0f8;padding:8px 12px">컨택 및 협의</td><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">D+0</td></tr>
<tr style="background:#fdfaff"><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">2</td><td style="border:1px solid #e0d0f8;padding:8px 12px">계약서 작성 및 서명</td><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">D+3</td></tr>
<tr><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">3</td><td style="border:1px solid #e0d0f8;padding:8px 12px">제품 발송</td><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">D+7</td></tr>
<tr style="background:#fdfaff"><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">4</td><td style="border:1px solid #e0d0f8;padding:8px 12px">촬영 및 업로드</td><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">D+21</td></tr>
<tr><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">5</td><td style="border:1px solid #e0d0f8;padding:8px 12px">성과 보고</td><td style="border:1px solid #e0d0f8;padding:8px 12px;text-align:center">D+28</td></tr>
</tbody>
</table>`;

  function insertTable() {
    const ta = templateTextareaRef.current;
    if (!ta) {
      setEditForm(p => ({ ...p, content: p.content + TIMELINE_TABLE_HTML }));
      return;
    }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = editForm.content.slice(0, start);
    const after = editForm.content.slice(end);
    const newContent = before + TIMELINE_TABLE_HTML + after;
    setEditForm(p => ({ ...p, content: newContent }));
    setTimeout(() => {
      ta.focus();
      ta.setSelectionRange(start + TIMELINE_TABLE_HTML.length, start + TIMELINE_TABLE_HTML.length);
    }, 0);
  }

  async function saveTemplate() {
    if (!editForm.name.trim() || !editForm.content.trim()) return;
    setSavingTemplate(true);
    if (editingTemplate?.id) {
      const res = await fetch(`/api/contact-templates?id=${editingTemplate.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        const updated: Template = await res.json();
        setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t));
        toast("문안이 수정됐습니다.", "success");
        setEditingTemplate(null);
      }
    } else {
      const res = await fetch("/api/contact-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        const created: Template = await res.json();
        setTemplates(prev => [...prev, created]);
        toast("문안이 추가됐습니다.", "success");
        setEditingTemplate(null);
      }
    }
    setSavingTemplate(false);
  }

  async function deleteTemplate(id: string) {
    if (!confirm("이 문안을 삭제하시겠습니까?")) return;
    const res = await fetch(`/api/contact-templates?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setTemplates(prev => prev.filter(t => t.id !== id));
      toast("문안이 삭제됐습니다.", "success");
    }
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const dateInfluencers = selectedDate
    ? influencers
        .filter(inf => inf.post_uploaded_at?.slice(0, 10) === selectedDate)
        .sort((a, b) => (b.screening_metrics?.[0]?.total_avg_play_count ?? 0) - (a.screening_metrics?.[0]?.total_avg_play_count ?? 0))
    : [];

  const selectedTrendPoint = selectedDate ? trendData.find(d => d.date === selectedDate) : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-a-ink transition text-sm">←</Link>
          <span className="text-a-ink text-sm font-semibold tracking-tight">인플루언서 컨택</span>
          {influencers.length > 0 && (
            <span className="text-gray-400 text-xs">{influencers.length}명 통과</span>
          )}
        </div>
      </header>

      {/* Toolbar */}
      <div className="sticky top-14 z-[35] bg-white border-b border-a-hairline px-6 h-11 flex items-center justify-between">
        <div className="flex items-center gap-4">
          {lastScreeningAt && (
            <span className="text-xs text-a-ink-muted whitespace-nowrap">
              마지막 스크리닝 <span className="font-medium text-a-ink">{formatTimestamp(lastScreeningAt)}</span>
            </span>
          )}
        </div>
        <button onClick={() => { setShowTemplates(true); setEditingTemplate(null); }} className="btn-secondary">
          컨택 문안 관리
        </button>
      </div>

      <div className="p-6 space-y-5">

        {/* Trend chart card */}
        <div className="bg-white rounded-[22px] shadow-[0_4px_32px_rgba(100,120,180,0.11)] p-5">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div className="inline-flex items-center gap-1.5 bg-blue-50 rounded-full px-3 py-1 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-a-blue inline-block" />
              <p className="text-[11px] font-semibold text-a-blue tracking-widest uppercase">검색 트렌드 (최근 1년)</p>
            </div>
            <select
              value={selectedKeyword}
              onChange={e => setSelectedKeyword(e.target.value)}
              className="filter-select"
            >
              <option value="">키워드 선택</option>
              {kwOptions.map(kw => <option key={kw} value={kw}>{kw}</option>)}
            </select>
            <button onClick={fetchTrend} disabled={!selectedKeyword || loadingTrend} className="btn-primary">
              {loadingTrend ? (
                <span className="flex items-center gap-1.5">
                  <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  조회 중
                </span>
              ) : "트렌드 조회"}
            </button>
            {loadingTrend && (
              <span className="text-xs text-a-ink-muted tabular-nums">
                {trendElapsed < 60 ? `${trendElapsed}초` : `${Math.floor(trendElapsed / 60)}분 ${trendElapsed % 60}초`}
              </span>
            )}
            {selectedDate && (
              <button onClick={() => setSelectedDate(null)} className="btn-ghost py-1 ml-auto">
                날짜 선택 해제
              </button>
            )}
          </div>

          {trendError ? (
            <div className="rounded-[10px] bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
              {trendError}
            </div>
          ) : trendData.length > 0 ? (
            <TrendChart data={trendData} selectedDate={selectedDate} onSelect={setSelectedDate} />
          ) : (
            <div className="h-[160px] flex items-center justify-center text-a-ink-muted text-sm rounded-[10px] bg-a-divider/40">
              키워드를 선택하고 &apos;트렌드 조회&apos;를 누르세요
            </div>
          )}
        </div>

        {/* Selected date panel */}
        {selectedDate && (
          <div className="bg-white rounded-[22px] shadow-[0_4px_32px_rgba(100,120,180,0.11)] p-5">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-sm font-semibold text-a-ink">{selectedDate} 업로드</h2>
              {selectedTrendPoint && (
                <span className="text-xs text-a-ink-muted">
                  검색량 <span className="font-semibold text-a-ink">{selectedTrendPoint.keywordAbsolute.toLocaleString()}</span>
                </span>
              )}
              <span className="text-xs text-a-ink-muted">{dateInfluencers.length}명</span>
            </div>

            {dateInfluencers.length === 0 ? (
              <p className="text-sm text-a-ink-muted">이 날 업로드한 인플루언서가 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {dateInfluencers.map(inf => {
                  const m = getMetrics(inf);
                  return (
                    <div key={inf.id} className="flex items-center gap-4 px-4 py-3 rounded-[10px] bg-a-divider/30 hover:bg-blue-50/40 transition">
                      <InfluencerName inf={inf} />

                      <span className="text-[11px] text-a-ink-muted shrink-0">
                        {platformLabel(inf.platform)}
                      </span>

                      {m?.total_avg_play_count != null ? (
                        <button
                          onClick={() => inf.sample_post_url && window.open(inf.sample_post_url, "_blank")}
                          className={`text-sm tabular-nums font-medium shrink-0 ${inf.sample_post_url ? "text-a-blue hover:underline cursor-pointer" : "text-a-ink"}`}
                        >
                          {m.total_avg_play_count.toLocaleString()} 조회
                        </button>
                      ) : (
                        <span className="text-sm text-a-ink-muted shrink-0">조회수 없음</span>
                      )}

                      <div className="flex-1" />

                      <button onClick={() => openContact(inf)} className="btn-primary shrink-0">
                        컨택
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* All pass influencers */}
        <div className="bg-white rounded-[22px] shadow-[0_4px_32px_rgba(100,120,180,0.11)] overflow-hidden">
          <div className="px-6 pt-5 pb-4 border-b border-a-hairline">
            <div className="inline-flex items-center gap-1.5 bg-blue-50 rounded-full px-3 py-1">
              <span className="w-1.5 h-1.5 rounded-full bg-a-blue inline-block" />
              <p className="text-[11px] font-semibold text-a-blue tracking-widest uppercase">통과 인플루언서 전체 ({influencers.length}명)</p>
            </div>
          </div>

          {loadingInf ? (
            <div className="p-8 text-center text-a-ink-muted text-sm">로딩 중...</div>
          ) : influencers.length === 0 ? (
            <div className="p-8 text-center text-a-ink-muted text-sm">
              스크리닝에서 통과된 인플루언서가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-a-hairline">
                    <th className="px-4 py-3 text-xs font-medium text-a-ink-muted text-left whitespace-nowrap">채널명</th>
                    <th className="px-3 py-3 text-xs font-medium text-a-ink-muted text-left whitespace-nowrap">플랫폼</th>
                    <th className="px-3 py-3 text-xs font-medium text-a-ink-muted text-left whitespace-nowrap">발굴 키워드</th>
                    <th className="px-3 py-3 text-xs font-medium text-a-ink-muted text-right whitespace-nowrap">팔로워</th>
                    <th className="px-3 py-3 text-xs font-medium text-a-ink-muted text-right whitespace-nowrap">알고리즘 계수</th>
                    <th className="px-3 py-3 text-xs font-medium text-a-ink-muted text-right whitespace-nowrap">
                      <span className="group/avp relative inline-block cursor-help border-b border-dotted border-a-hairline">
                        평균 조회수
                        <div className="hidden group-hover/avp:block absolute top-full right-0 mt-1.5 z-[9999] bg-white border border-a-hairline rounded-[10px] shadow-lg px-3.5 py-3 min-w-[240px] text-left font-normal normal-case tracking-normal">
                          <div className="space-y-3">
                            <div>
                              <p className="text-[11px] font-semibold text-a-ink mb-1">① 평균 조회수</p>
                              <p className="text-[11px] text-a-ink-muted mb-1.5">최근 콘텐츠 평균 (알고리즘 떡상 건 제외)</p>
                              <div className="space-y-0.5 text-[11px]">
                                <p><span className="font-semibold text-emerald-600">BEST</span> <span className="text-a-ink-muted">= 10만 이상</span></p>
                                <p><span className="font-semibold text-blue-500">GOOD</span> <span className="text-a-ink-muted">= 7만 이상</span></p>
                                <p><span className="text-gray-400">BAD = 7만 미만</span></p>
                              </div>
                            </div>
                            <div>
                              <p className="text-[11px] font-semibold text-a-ink mb-1">② 팔로워 대비 조회율</p>
                              <p className="text-[11px] text-a-ink-muted mb-1.5">평균 조회수 ÷ 팔로워 · 알고리즘 파급력 지표</p>
                              <div className="space-y-0.5 text-[11px]">
                                <p><span className="font-semibold text-emerald-600">BEST</span> <span className="text-a-ink-muted">= 1 이상</span></p>
                                <p><span className="font-semibold text-blue-500">GOOD</span> <span className="text-a-ink-muted">= 0 이상</span></p>
                                <p><span className="text-gray-400">BAD = 음수</span></p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </span>
                    </th>
                    <th className="px-3 py-3 text-xs font-medium text-a-ink-muted text-left whitespace-nowrap">업로드일</th>
                    <th className="px-3 py-3 text-xs font-medium text-a-ink-muted text-left whitespace-nowrap" style={{ minWidth: 160 }}>특이사항</th>
                    <th className="px-3 py-3 text-xs font-medium text-a-ink-muted text-center whitespace-nowrap">컨택</th>
                  </tr>
                </thead>
                <tbody>
                  {influencers.map(inf => {
                    const m = getMetrics(inf);
                    return (
                      <tr key={inf.id} className="group border-b border-a-divider last:border-0 hover:bg-a-parchment/60 transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          {editContactName?.id === inf.id ? (
                            <input autoFocus value={editContactName.value}
                              onChange={e => setEditContactName(v => v ? { ...v, value: e.target.value } : null)}
                              onBlur={() => patchContactName(inf.id, editContactName.value)}
                              onKeyDown={e => { if (e.key === "Enter") patchContactName(inf.id, editContactName.value); if (e.key === "Escape") setEditContactName(null); }}
                              className="text-sm font-medium bg-transparent border-b border-a-blue outline-none py-0.5" />
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <InfluencerName inf={inf} />
                              <button onClick={() => setEditContactName({ id: inf.id, value: inf.name })}
                                className="opacity-0 group-hover:opacity-100 text-a-ink-muted hover:text-a-ink transition flex-shrink-0" title="이름 수정">
                                <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                                  <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs text-a-ink-muted whitespace-nowrap">
                          {platformLabel(inf.platform)}
                        </td>
                        <td className="px-3 py-3 text-xs text-a-ink-muted whitespace-nowrap">
                          {inf.keyword ?? "-"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                          {fmt(m?.followers)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                          {m?.avg_views_per_follower?.toFixed(2) ?? "-"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                          {m?.total_avg_play_count != null ? (
                            <button
                              onClick={() => inf.sample_post_url && window.open(inf.sample_post_url, "_blank")}
                              className={`tabular-nums ${inf.sample_post_url ? "text-a-blue hover:underline cursor-pointer" : "text-a-ink"}`}
                            >
                              {m.total_avg_play_count.toLocaleString()}
                            </button>
                          ) : "-"}
                        </td>
                        <td className="px-3 py-3 text-xs text-a-ink-muted whitespace-nowrap">
                          {inf.post_uploaded_at?.slice(0, 10) ?? "-"}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap" style={{ minWidth: 160 }}>
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
                        <td className="px-3 py-3 text-center whitespace-nowrap">
                          <button onClick={() => openContact(inf)} className="btn-primary">
                            컨택
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Contact Modal */}
      {contactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setContactModal(null)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[520px] max-h-[90vh] overflow-y-auto p-7">
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-[10px] font-semibold text-a-blue tracking-[0.1em] uppercase mb-1">컨택</p>
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">{contactModal.name}</h2>
              </div>
              <button onClick={() => setContactModal(null)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* Template selector */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-a-ink">컨택 문안</label>
                <button onClick={() => { setShowTemplates(true); setEditingTemplate(null); }}
                  className="text-xs text-a-blue hover:underline flex items-center gap-1">
                  <svg width="11" height="11" viewBox="0 0 20 20" fill="none">
                    <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                  </svg>
                  문안 관리
                </button>
              </div>
              <select
                value={selectedTemplateId}
                onChange={e => handleTemplateSelect(e.target.value)}
                className="filter-select w-full"
              >
                <option value="">문안 선택...</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>

            {/* Editable message */}
            <div className="mb-4">
              <label className="text-xs font-semibold text-a-ink block mb-2">메시지</label>
              <textarea
                value={contactText}
                onChange={e => setContactText(e.target.value)}
                rows={8}
                className="border border-a-hairline rounded-[8px] px-3 py-2.5 text-xs w-full focus:outline-none focus:border-a-blue transition resize-none"
                placeholder="컨택 문안을 입력하거나 위에서 선택하세요"
              />
            </div>

            {/* Email input */}
            <div className="mb-5">
              <label className="text-xs font-semibold text-a-ink block mb-2">이메일 주소 <span className="font-normal text-a-ink-muted">(메일 컨택 시 입력)</span></label>
              <input
                type="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                placeholder="example@email.com"
                className="filter-input w-full"
              />
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-2">
              <button onClick={() => setContactModal(null)}
                className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment transition">
                취소
              </button>
              <button onClick={handleDM}
                className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment transition">
                DM으로 컨택
              </button>
              <button onClick={handleGmail} disabled={!contactEmail}
                className="text-xs px-4 py-2 rounded-full bg-a-blue text-white hover:bg-a-blue-hover disabled:opacity-40 transition">
                메일로 컨택
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Template Manager Modal */}
      {showTemplates && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
            onClick={() => { setShowTemplates(false); setEditingTemplate(null); }} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[540px] max-w-[calc(100vw-32px)] max-h-[85vh] overflow-y-auto overflow-x-hidden p-7" style={{ wordBreak: 'break-word' }}>
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="text-[10px] font-semibold text-a-blue tracking-[0.1em] uppercase mb-1">설정</p>
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">컨택 문안 관리</h2>
              </div>
              <button onClick={() => { setShowTemplates(false); setEditingTemplate(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

            {/* 주의사항 메모 */}
            <div className="mb-5 rounded-[10px] border border-gray-100 px-4 py-3"
              style={{ background: "linear-gradient(135deg, #ffffff 0%, #f8f8fc 100%)", boxShadow: "0 1px 6px rgba(0,0,0,0.06)" }}>
              <p className="text-[14px] font-bold text-a-ink mb-1">
                ❗이전 협찬 히스토리를 모르는 건 당연한 것❗
              </p>
              <p className="text-[12px] font-medium text-a-ink-muted mb-2">
                → 이전 히스토리를 스스로 찾고 톤앤매너에 맞춰 소통하자
              </p>
              <ul className="space-y-0.5">
                {[
                  "기존 히스토리를 보면서 소통하자 → 인지셀메일 / 전환셀메일 / 컨택3계정 DM창",
                  "혹시 이전에 컨택했는데 신규 문안으로 컨택하진 않았는지?",
                  "광고비 회신이 왔지만 처음처럼 물어보진 않았는지?",
                  "이전에 우리가 협찬제안을 했지만 답을 못해 어영부영 넘어가진 않았는지?",
                ].map((item, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-a-ink-muted leading-none">
                    <span className="flex-shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {/* 이미지 첨부: web/public/contact-history-example.png 파일을 넣으면 표시됨 */}
              <img src="/contact-history-example.png" alt="히스토리 예시"
                className="mt-3 rounded-[6px] max-w-full object-contain block"
                onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <a
                href="https://app.notion.com/p/lalasweet/35a3b344ce7f81eab025c062af02bba7"
                target="_blank"
                rel="noreferrer"
                className="mt-2.5 flex items-center gap-1.5 text-[11px] text-a-blue hover:underline transition-colors"
              >
                <span>✅</span>
                <span className="font-medium">협찬 프로세스 체크리스트</span>
                <svg width="10" height="10" viewBox="0 0 14 14" fill="none" className="opacity-60">
                  <path d="M5.5 2.5H2.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8.5 1.5h4m0 0v4m0-4L6 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </a>
            </div>

            {!editingTemplate ? (
              <>
                <div className="space-y-2 mb-4">
                  {templates.length === 0 && (
                    <p className="text-sm text-a-ink-muted text-center py-6">저장된 문안이 없습니다.</p>
                  )}
                  {templates.map(tpl => (
                    <div key={tpl.id} className="flex items-center gap-3 px-4 py-3 rounded-[10px] bg-a-parchment">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-a-ink">{tpl.name}</p>
                        <p className="text-[11px] text-a-ink-muted truncate mt-0.5">
                          {tpl.content.slice(0, 60)}{tpl.content.length > 60 ? "..." : ""}
                        </p>
                      </div>
                      <button onClick={() => startEdit(tpl)}
                        className="shrink-0 text-a-ink-muted hover:text-a-ink transition p-1.5 rounded-full hover:bg-black/[0.06]"
                        title="수정">
                        <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                          <path d="M14.5 2.5l3 3L6 17H3v-3L14.5 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
                        </svg>
                      </button>
                      <button onClick={() => deleteTemplate(tpl.id)}
                        className="shrink-0 text-a-ink-muted hover:text-red-500 transition p-1.5 rounded-full hover:bg-red-50"
                        title="삭제">
                        <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                          <path d="M4 6h12M8 6V4h4v2M7 6v10h6V6H7z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={startNew} className="w-full btn-secondary">
                  + 새 문안 추가
                </button>
              </>
            ) : (
              <>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-a-ink block mb-1.5">문안 이름</label>
                    <input
                      type="text"
                      value={editForm.name}
                      onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="예) 기본 협찬 제안"
                      className="filter-input w-full"
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-a-ink">문안 내용</label>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-a-ink-muted">{"{name}"} → 이름 자동 치환</span>
                        <button type="button" onClick={insertTable}
                          className="text-[11px] px-2.5 py-1 rounded-full border border-a-blue text-a-blue hover:bg-blue-50 transition whitespace-nowrap">
                          📊 타임라인 표 삽입
                        </button>
                        <button type="button" onClick={() => setTemplatePreview(p => !p)}
                          className={`text-[11px] px-2.5 py-1 rounded-full border transition whitespace-nowrap ${
                            templatePreview ? "border-emerald-500 text-emerald-600 bg-emerald-50" : "border-a-hairline text-a-ink-muted hover:bg-a-parchment"
                          }`}>
                          {templatePreview ? "✏️ 편집" : "👁️ 미리보기"}
                        </button>
                      </div>
                    </div>
                    {templatePreview ? (
                      <div
                        className="border border-a-hairline rounded-[8px] px-3 py-2.5 text-xs w-full min-h-[200px] bg-a-parchment/30 prose-sm"
                        style={{ fontSize: 12, lineHeight: 1.7 }}
                        dangerouslySetInnerHTML={{ __html: sanitizeHtml(editForm.content.replace(/\n/g, "<br/>")) }}
                      />
                    ) : (
                      <textarea
                        ref={templateTextareaRef}
                        value={editForm.content}
                        onChange={e => setEditForm(p => ({ ...p, content: e.target.value }))}
                        rows={10}
                        className="border border-a-hairline rounded-[8px] px-3 py-2.5 text-xs w-full focus:outline-none focus:border-a-blue transition resize-none font-mono"
                        placeholder="안녕하세요, {name}님! ..."
                      />
                    )}
                    {editForm.content.includes('<table') && (
                      <p className="text-[10px] text-a-ink-muted mt-1">
                        💡 Gmail 등 HTML 이메일 편집기에 붙여넣으면 표 형태로 전송됩니다.
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-5 flex justify-end gap-2">
                  <button onClick={() => setEditingTemplate(null)}
                    className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment transition">
                    취소
                  </button>
                  <button onClick={saveTemplate}
                    disabled={savingTemplate || !editForm.name.trim() || !editForm.content.trim()}
                    className="text-xs px-4 py-2 rounded-full bg-a-blue text-white hover:bg-a-blue-hover disabled:opacity-40 transition">
                    {savingTemplate ? "저장 중..." : "저장"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ToastContainer toasts={toasts} />
    </div>
  );
}
