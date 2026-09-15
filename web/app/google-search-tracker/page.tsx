"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { analyzeTrends, dateOffset, parseGroups, trendSummary, validateConfig, validateResult, validDate, type TrackerConfig, type TrackerContent, type TrackerEvent, type TrackerResult } from "@/lib/google-search-tracker";

type Kind = "trends" | "youtube" | "instagram";
type Pending = { receipt: string; kind: Kind; key: string; config: TrackerConfig; started: number };
type Snapshot = { name: string; config: TrackerConfig; result: TrackerResult; manual: TrackerEvent[]; contents: Record<string, TrackerContent[]> };
const COLORS = ["#2563eb", "#e87722", "#0d9488", "#ad46b8", "#e04060"];
const DEFAULT_GROUPS = "라라스윗=라라스윗,라라스윗아이스크림|라라스윗\n쫀득바=쫀득바,라라스윗쫀득바|쫀득바\n멜론 쫀득바=멜론쫀득바,라라스윗멜론쫀득바|멜론쫀득바";
const field = "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100";
const button = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:cursor-wait disabled:opacity-50";
const primary = "rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-wait disabled:opacity-50";
const fmt = (n: number | null | undefined, digits = 1) => typeof n === "number" ? n.toLocaleString("ko-KR", { maximumFractionDigits: digits }) : "—";
const contentKey = (e: TrackerEvent, kind: string) => kind === "instagram" ? `${e.group}:instagram` : `${e.id}:${kind}`;
const groupText = (c: TrackerConfig) => c.groups.map(g => `${g.label}=${g.terms.join(",")}${g.tags.length ? "|" + g.tags.join(",") : ""}`).join("\n");
async function api(body: unknown, path = "/api/google-search-tracker") {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("로그인이 만료됐거나 서버에 연결할 수 없습니다. 새로고침 후 다시 시도하세요.");
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "요청에 실패했습니다.");
  return data;
}
function download(data: Blob, name: string) { const url = URL.createObjectURL(data); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }

function TrendChart({ result, config, events, visible }: { result: TrackerResult; config: TrackerConfig; events: TrackerEvent[]; visible: Set<number> }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const points = result.points.filter(p => p.date >= config.start);
  const W = 1000, H = 330, L = 45, R = 20, T = 25, B = 42;
  const span = Math.max(86400000, Date.parse(config.end) - Date.parse(config.start));
  const x = (date: string) => L + (Date.parse(date) - Date.parse(config.start)) / span * (W - L - R);
  const y = (value: number) => H - B - value / 100 * (H - T - B);
  async function png() {
    if (!ref.current) return;
    const blob = new Blob([new XMLSerializer().serializeToString(ref.current)], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob); const img = new Image();
    img.onload = () => { const canvas = document.createElement("canvas"); canvas.width = W * 2; canvas.height = H * 2; const ctx = canvas.getContext("2d"); if (ctx) { ctx.fillStyle = "white"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height); canvas.toBlob(b => { if (b) download(b, "google-search-interest.png"); }); } URL.revokeObjectURL(url); };
    img.onerror = () => URL.revokeObjectURL(url); img.src = url;
  }
  return <div className="rounded-xl border border-slate-200 bg-white p-5">
    <div className="mb-2 flex items-center justify-between"><h2 className="font-semibold">검색 관심도 추이</h2><button className={button} onClick={png}>차트 PNG</button></div>
    <div className="relative">
      <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="상품별 Google Trends 검색 관심도, 0에서 100까지" onMouseLeave={() => setHover(null)} onMouseMove={e => {
        const bounds = e.currentTarget.getBoundingClientRect(); const pos = (e.clientX - bounds.left) / bounds.width * W;
        setHover(points.reduce((best, p, i) => Math.abs(x(p.date) - pos) < Math.abs(x(points[best].date) - pos) ? i : best, 0));
      }}>
        <rect width={W} height={H} fill="white" />
        {[0, 25, 50, 75, 100].map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#e2e8f0" /><text x={L - 10} y={y(v) + 4} textAnchor="end" fontSize="12" fill="#64748b">{v}</text></g>)}
        {[0, 0.25, 0.5, 0.75, 1].map(t => { const date = new Date(Date.parse(config.start) + t * span).toISOString().slice(0, 10); return <text key={t} x={L + t * (W - L - R)} y={H - 15} textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"} fontSize="12" fill="#64748b">{date}</text>; })}
        {config.groups.map((g, group) => {
          if (!visible.has(group)) return null;
          let path = "", connected = false;
          points.forEach(p => { const v = p.values[group]; if (typeof v !== "number") { connected = false; return; } path += `${connected ? "L" : "M"}${x(p.date)},${y(v)} `; connected = true; });
          return <g key={g.id}><path d={path} fill="none" stroke={COLORS[group]} strokeWidth="2" />{points.map(p => typeof p.values[group] === "number" ? <circle key={p.date} cx={x(p.date)} cy={y(p.values[group]!)} r="2.2" fill={COLORS[group]} /> : null)}</g>;
        })}
        {events.map((e, i) => visible.has(e.group) ? <g key={e.id}>
          {e.manual && <line x1={x(e.date)} x2={x(e.date)} y1={T} y2={H - B} stroke={COLORS[e.group]} strokeDasharray="4 4" opacity="0.4" />}
          <circle cx={x(e.date)} cy={e.peak === null ? T + 12 : Math.max(T + 10, y(e.peak) - 15)} r="10" fill={COLORS[e.group]} />
          <text x={x(e.date)} y={(e.peak === null ? T + 12 : Math.max(T + 10, y(e.peak) - 15)) + 4} textAnchor="middle" fontSize="11" fill="white">{i + 1}</text>
        </g> : null)}
      </svg>
      {hover !== null && points[hover] && <div className="pointer-events-none absolute right-2 top-2 rounded-lg border bg-white/95 p-3 text-xs shadow-sm"><b>{points[hover].date}</b>{config.groups.map((g, i) => visible.has(i) && <div key={g.id} style={{ color: COLORS[i] }}>{g.label}: {fmt(points[hover].values[i])}</div>)}</div>}
    </div>
    <p className="text-xs text-slate-500">번호는 아래 이벤트 카드와 연결됩니다. 빈 표본은 선을 연결하지 않습니다. 모든 상품은 같은 요청의 정규화 기준을 사용합니다.</p>
  </div>;
}
function EventCard({ event: e, index, config, selected, toggle, contents, collect, busy }: { event: TrackerEvent; index: number; config: TrackerConfig; selected: boolean; toggle: () => void; contents: Record<string, TrackerContent[]>; collect: (e: TrackerEvent, kind: "youtube" | "instagram" | "news") => void; busy: boolean }) {
  const [tab, setTab] = useState<"youtube" | "instagram" | "news">("youtube");
  const rows = contents[contentKey(e, tab)];
  return <article className="rounded-xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><label className="flex cursor-pointer items-center gap-3"><input type="checkbox" checked={selected} onChange={toggle} aria-label={`${index + 1}번 이벤트 분석에 포함`} /><span className="flex h-7 w-7 items-center justify-center rounded-full text-sm text-white" style={{ background: COLORS[e.group] }}>{index + 1}</span><span><b>{config.groups[e.group].label}</b><span className="ml-2 text-sm text-slate-500">{e.kind}</span><span className="block text-xs text-slate-500">{e.start === e.end ? e.date : `${e.start} ~ ${e.end} · 피크 ${e.date}`}</span></span></label>
      <div className="text-right text-sm"><b>관심도 {fmt(e.peak)}</b><p className="text-xs text-slate-500">{e.manual ? "직접 지정한 날짜" : `직전 평균 ${fmt(e.baseline)} · ${e.change === null ? "상승률 계산 불가" : "+" + fmt(e.change, 0) + "%"}`}</p></div></div>
    <div className="mt-4 flex gap-1 border-b">{(["youtube", "instagram", "news"] as const).map(kind => <button key={kind} className={`px-3 py-2 text-sm ${tab === kind ? "border-b-2 border-blue-600 font-semibold text-blue-600" : "text-slate-500"}`} onClick={() => setTab(kind)}>{kind === "youtube" ? "YouTube" : kind === "instagram" ? "인스타 릴스" : "뉴스·블로그"}</button>)}</div>
    <div className="my-3 flex flex-wrap items-center justify-between gap-2"><p className="max-w-xl text-xs leading-relaxed text-slate-500">{tab === "instagram" ? "상품별 태그 검색 결과를 모든 이벤트에서 재사용합니다. 이벤트 당시 게시물 순위가 아닙니다." : tab === "youtube" ? `대표 검색어의 인기 검색 결과 중 ${dateOffset(e.date, -config.windowDays)} ~ ${dateOffset(e.date, config.windowDays)} 게시물만 표시합니다. 전체 과거 게시물 순위는 아닙니다.` : "최신 뉴스·블로그 검색 각 100건에서 이벤트 기간을 확인합니다. 오래된 이벤트는 결과가 없을 수 있습니다."}</p><button className={button} disabled={busy} onClick={() => collect(e, tab)}>{rows ? "다시 조회" : "콘텐츠 조회"}</button></div>
    {rows === undefined ? <p className="py-3 text-sm text-slate-400">조회 버튼을 누르면 관련 콘텐츠를 수집합니다.</p> : !rows.length ? <p className="py-3 text-sm text-slate-500">조회 결과에서 조건에 맞는 게시물을 찾지 못했습니다. 콘텐츠가 없다는 뜻은 아닙니다.</p> : <div className="divide-y">{rows.map(p => <div className="py-3" key={p.url}><a className="text-sm font-medium text-blue-700 hover:underline" href={p.url} target="_blank" rel="noopener noreferrer">{p.title || "게시물 열기"}</a><p className="mt-1 text-xs text-slate-500">{p.author} · {p.date || "게시일 미확인"}{p.views !== null ? ` · 조회 ${fmt(p.views, 0)}` : ""}{p.likes !== null ? ` · 좋아요 ${fmt(p.likes, 0)}` : ""}</p><p className="mt-1 line-clamp-2 text-xs text-slate-500">{p.description}</p></div>)}</div>}
  </article>;
}
export default function GoogleSearchTracker() {
  const { user } = useUser();
  const today = new Date().toISOString().slice(0, 10);
  const [groups, setGroups] = useState(DEFAULT_GROUPS), [start, setStart] = useState(dateOffset(today, -90)), [end, setEnd] = useState(dateOffset(today, -1)), [geo, setGeo] = useState("KR");
  const [multiplier, setMultiplier] = useState(2.5), [minIndex, setMinIndex] = useState(5), [gapDays, setGapDays] = useState(7), [windowDays, setWindowDays] = useState(7);
  const [config, setConfig] = useState<TrackerConfig | null>(null), [result, setResult] = useState<TrackerResult | null>(null);
  const [manual, setManual] = useState<TrackerEvent[]>([]), [manualDate, setManualDate] = useState(""), [manualGroup, setManualGroup] = useState(0);
  const [contents, setContents] = useState<Record<string, TrackerContent[]>>({}), [pending, setPending] = useState<Pending | null>(null), [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<Snapshot[]>([]), [name, setName] = useState(""), [openName, setOpenName] = useState("");
  const [visible, setVisible] = useState(new Set([0, 1, 2, 3, 4])), [excluded, setExcluded] = useState(new Set<string>()), [prompt, setPrompt] = useState("");
  const storage = user ? `google-search-tracker-v1:${user.id}` : "";
  const [loadedStorage, setLoadedStorage] = useState("");
  const events = useMemo(() => result && config ? [...analyzeTrends(result, config), ...manual].sort((a, b) => a.date.localeCompare(b.date) || a.group - b.group) : [], [result, config, manual]);
  const readConfig = () => validateConfig({ groups: parseGroups(groups), start, end, geo, multiplier, minIndex, gapDays, windowDays });
  const applyInputs = (c: TrackerConfig) => { setGroups(groupText(c)); setStart(c.start); setEnd(c.end); setGeo(c.geo); setMultiplier(c.multiplier); setMinIndex(c.minIndex); setGapDays(c.gapDays); setWindowDays(c.windowDays); };
  useEffect(() => {
    if (!storage) return;
    try {
      const data = JSON.parse(localStorage.getItem(storage) || "{}");
      setSaved(Array.isArray(data.saved) ? data.saved : []);
      setPending(null);
      setConfig(null); setResult(null); setManual([]); setContents({}); setExcluded(new Set()); setPrompt("");
      if (data.active) {
        const c = validateConfig(data.active.config), r = validateResult(data.active.result, c);
        setConfig(c); setResult(r); applyInputs(c); setManual(data.active.manual || []); setManualGroup(0); setContents(data.active.contents || {});
      }
      if (data.pending && data.pending.started > Date.now() - 24 * 3600000) setPending(data.pending);
    } catch { setNotice("저장된 분석을 읽지 못했습니다. 새 분석을 시작할 수 있습니다."); }
    setLoadedStorage(storage);
  }, [storage]);
  useEffect(() => {
    if (!storage || loadedStorage !== storage) return;
    try { localStorage.setItem(storage, JSON.stringify({ saved, pending, active: config && result ? { config, result, manual, contents } : null })); } catch { setNotice("브라우저 저장 공간이 부족합니다. 엑셀로 내보낸 후 저장된 분석을 정리하세요."); }
  }, [storage, loadedStorage, saved, pending, config, result, manual, contents]);
  useEffect(() => {
    if (!pending || paused) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>, failures = 0;
    setBusy(true);
    async function poll() {
      if (!pending || stopped) return;
      try {
        const data = await api({ action: "poll", receipt: pending.receipt });
        if (stopped) return;
        failures = 0;
        if (data.status === "running") {
          if (Date.now() - pending.started > 11 * 60000) { setPaused(true); setBusy(false); setError("수집이 오래 걸리고 있습니다. 완료 확인 버튼으로 다시 확인할 수 있습니다."); return; }
          timer = setTimeout(poll, 8000); return;
        }
        if (pending.kind === "trends") {
          setConfig(pending.config); setResult(data.result); applyInputs(pending.config); setManual([]); setManualGroup(0); setContents({}); setExcluded(new Set()); setPrompt(""); setVisible(new Set([0, 1, 2, 3, 4]));
        } else setContents(current => ({ ...current, [pending.key]: data.content }));
        setPending(null); setBusy(false); setNotice("수집이 완료됐습니다.");
      } catch (e) {
        if (stopped) return;
        failures++;
        if (failures < 3) { timer = setTimeout(poll, 8000); return; }
        setError(e instanceof Error ? e.message : "수집 상태 확인 실패"); setBusy(false); setPaused(true);
      }
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
    // The run carries the exact query configuration, including when returning to this page.
  }, [pending, paused]);
  async function run(kind: Kind, c: TrackerConfig, key = "", group = 0, date = c.start) {
    setBusy(true); setError(""); setNotice("");
    try { const data = await api({ action: "start", kind, config: c, group, date }); setPaused(false); setPending({ receipt: data.receipt, kind, key, config: c, started: Date.now() }); }
    catch (e) { setBusy(false); setError(e instanceof Error ? e.message : "수집 시작 실패"); }
  }
  async function collect(e: TrackerEvent, kind: "youtube" | "instagram" | "news") {
    if (!config) return;
    if (kind !== "news") { await run(kind, config, contentKey(e, kind), e.group, e.date); return; }
    setBusy(true); setError("");
    try { const data = await api({ config, group: e.group, date: e.date }, "/api/google-search-tracker/news"); setContents(current => ({ ...current, [contentKey(e, kind)]: data.content })); }
    catch (error) { setError(error instanceof Error ? error.message : "조회 실패"); } finally { setBusy(false); }
  }
  function addManual() {
    if (!config || !result || !validDate(manualDate) || manualDate < config.start || manualDate > config.end) { setError("분석 기간 안의 날짜를 지정하세요."); return; }
    if (manual.length >= 100) { setError("수동 날짜는 최대 100개입니다."); return; }
    const id = `manual:${manualGroup}:${manualDate}`;
    if (manual.some(e => e.id === id)) return;
    setManual(current => [...current, { id, group: manualGroup, date: manualDate, start: manualDate, end: manualDate, peak: result.points.find(p => p.date === manualDate)?.values[manualGroup] ?? null, baseline: null, change: null, kind: "수동 날짜", manual: true }]); setError("");
  }
  function save() {
    if (!config || !result || !name.trim()) { setError("저장할 분석의 이름을 입력하세요."); return; }
    const item = { name: name.trim().slice(0, 60), config, result, manual, contents };
    setSaved(current => [item, ...current.filter(s => s.name !== item.name)].slice(0, 8)); setOpenName(item.name); setNotice("이 브라우저에 저장했습니다. 같은 이름은 새 결과로 갱신됩니다.");
  }
  function load() {
    const s = saved.find(s => s.name === openName); if (!s) return;
    try { const c = validateConfig(s.config), r = validateResult(s.result, c); applyInputs(c); setConfig(c); setResult(r); setManual(s.manual || []); setManualGroup(0); setContents(s.contents || {}); setExcluded(new Set()); setPrompt(""); setError(""); } catch { setError("저장된 분석 데이터가 올바르지 않습니다."); }
  }
  async function exportExcel() {
    if (!config || !result) return;
    setBusy(true); setError("");
    try { const response = await fetch("/api/google-search-tracker/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config, result, manual, contents }) }); if (!response.ok) { const body = await response.json(); throw new Error(body.error || "내보내기 실패"); } download(await response.blob(), `google-search-tracker-${config.start}-${config.end}.xlsx`); } catch (e) { setError(e instanceof Error ? e.message : "내보내기 실패"); } finally { setBusy(false); }
  }
  function csv() {
    if (!config || !result) return;
    const cell = (v: unknown) => { const s = String(v ?? ""); return `"${(/^[=+@-]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };
    const rows = [["날짜 UTC", ...config.groups.map(g => `${g.label} 상대지수`)], ...result.points.filter(p => p.date >= config.start).map(p => [p.date, ...p.values])];
    download(new Blob(["\uFEFF" + rows.map(row => row.map(cell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }), "google-search-interest.csv");
  }
  function buildPrompt() {
    if (!config || !result) return;
    const chosen = events.filter(e => !excluded.has(e.id));
    if (!chosen.length) { setError("분석에 포함할 이벤트를 선택하세요."); return; }
    setPrompt(["라라스윗 Google 검색 관심도 상승 원인을 분석해 주세요.", `기간: ${config.start} ~ ${config.end}; 국가: ${config.geo || "전 세계"}; 원본 간격: ${result.granularity}.`, "지표는 Google Trends 상대 관심도 0–100이며 실제 검색 횟수가 아닙니다. 연령별 데이터는 제공되지 않습니다. 결측은 0으로 계산하지 마세요. 모든 상품은 동일 비교 요청으로 정규화했으며 직전 28일을 포함합니다.", `급등 기준: 직전 28일 유효 표본(최소 3개) 평균의 ${config.multiplier}배 이상, 지수 ${config.minIndex} 이상. ${config.gapDays}일 이내 급등은 하나로 묶습니다.`, "콘텐츠의 시점과 검색 상승의 선후관계를 검토하고, 상관관계와 인과관계를 구분하세요. 조회되지 않은 콘텐츠나 수치를 만들지 마세요. 인스타 결과는 상품 전체의 현재 검색 결과이며, YouTube와 뉴스 검색 결과도 완전한 과거 목록이 아닙니다.", ...chosen.flatMap((e, i) => [`\n[이벤트 ${i + 1}] ${config.groups[e.group].label} / ${e.kind} / ${e.start} ~ ${e.end} / 피크 ${e.date}`, `관심도 ${fmt(e.peak)}, 직전 평균 ${fmt(e.baseline)}, 상승률 ${e.change === null ? "계산 불가" : fmt(e.change, 0) + "%"}`, ...["youtube", "instagram", "news"].flatMap(kind => { const rows = contents[contentKey(e, kind)]; return [`${kind}: ${rows === undefined ? "미조회" : rows.length + "건"}`, ...(rows || []).map(p => `${p.date || "게시일 미확인"} | ${p.title} | ${p.author} | 조회 ${fmt(p.views, 0)} | 좋아요 ${fmt(p.likes, 0)} | ${p.url}\n${p.description}`)]; })]), "\n상품별 상승 원인 후보와 근거 링크, 불확실한 점, 추가로 확인할 자료를 정리하고 마케팅 시사점을 제안해 주세요."].join("\n")); setError("");
  }
  return <main className="min-h-screen bg-slate-50 px-5 pb-12 pt-20 lg:px-8">
    <div className="mx-auto max-w-[1500px]">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><p className="mb-1 text-xs font-semibold tracking-wide text-blue-600">GOOGLE TRENDS</p><h1 className="text-2xl font-bold">구글 검색 트래킹</h1><p className="mt-2 text-sm text-slate-500">검색 관심도의 변화를 찾고, 관련 콘텐츠와 함께 상승 원인을 검토합니다.</p></div><a href="https://search-tracker-lalasweet.streamlit.app/" className="text-sm text-blue-600 hover:underline">네이버 버전 열기 ↗</a></div>
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-700">{notice}</div>}
      {pending && <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700"><span>{paused ? "완료 확인이 일시 중지됐습니다." : `${pending.kind === "trends" ? "Google Trends" : pending.kind === "youtube" ? "YouTube" : "인스타 릴스"} 수집 중입니다. 보통 수 분이 걸립니다. 이 페이지에 다시 오면 완료 확인을 이어갑니다.`}</span>{paused && <div className="flex gap-2"><button className={button} onClick={() => { setError(""); setPaused(false); }}>완료 확인</button><button className={button} onClick={() => { setPending(null); setPaused(false); setError(""); }}>확인 닫기</button></div>}</div>}
      <div className="grid items-start gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-5 rounded-xl border border-slate-200 bg-white p-5">
          <div><h2 className="mb-3 font-semibold">분석 설정</h2><label className="mb-2 block text-xs font-medium text-slate-600" htmlFor="groups">상품별 검색어 묶음</label><textarea id="groups" className={`${field} min-h-[155px] font-mono text-xs leading-6`} value={groups} disabled={busy || !!pending} onChange={e => setGroups(e.target.value)} /><p className="mt-2 text-xs leading-relaxed text-slate-500">한 줄에 상품명=검색어1,검색어2<br />선택: |인스타태그1,태그2<br />최대 5개 상품. 묶음 안의 검색어는 OR 조건입니다.</p></div>
          <div className="grid grid-cols-2 gap-2"><label className="text-xs text-slate-600">시작일<input aria-label="시작일" type="date" className={`${field} mt-1 px-2`} value={start} onChange={e => setStart(e.target.value)} disabled={busy || !!pending} /></label><label className="text-xs text-slate-600">종료일<input aria-label="종료일" type="date" className={`${field} mt-1 px-2`} value={end} max={today} onChange={e => setEnd(e.target.value)} disabled={busy || !!pending} /></label></div>
          <label className="block text-xs text-slate-600">검색 지역<select className={`${field} mt-1`} value={geo} onChange={e => setGeo(e.target.value)} disabled={busy || !!pending}><option value="KR">대한민국</option><option value="">전 세계</option><option value="US">미국</option><option value="JP">일본</option></select></label>
          <details><summary className="cursor-pointer text-sm font-medium">고급 분석 설정</summary><div className="mt-3 space-y-3">{[{ label: "직전 28일 평균 배수", value: multiplier, set: setMultiplier, min: 1.5, max: 5, step: 0.5 }, { label: "최소 관심도 지수", value: minIndex, set: setMinIndex, min: 1, max: 100, step: 1 }, { label: "이벤트 묶음 간격 (일)", value: gapDays, set: setGapDays, min: 1, max: 21, step: 1 }, { label: "콘텐츠 조회 전후 (일)", value: windowDays, set: setWindowDays, min: 1, max: 21, step: 1 }].map(f => <label key={f.label} className="block text-xs text-slate-600">{f.label}<input aria-label={f.label} type="number" className={`${field} mt-1`} value={f.value} min={f.min} max={f.max} step={f.step} onChange={e => f.set(Number(e.target.value))} disabled={busy || !!pending} /></label>)}<button className={`${button} w-full`} disabled={!config || busy || !!pending} onClick={() => { try { const c = validateConfig({ ...config, multiplier, minIndex, gapDays, windowDays }); setConfig(c); setExcluded(new Set()); setPrompt(""); setNotice("현재 수집 결과에 새 급등 기준을 적용했습니다."); } catch (e) { setError(e instanceof Error ? e.message : "설정 확인"); } }}>수집 결과에 기준 적용</button></div></details>
          <button className={`${primary} w-full`} disabled={busy || !!pending} onClick={() => { try { void run("trends", readConfig()); } catch (e) { setError(e instanceof Error ? e.message : "설정 확인"); } }}>검색 관심도 수집·분석</button>
          <p className="text-xs leading-relaxed text-slate-500">버튼을 누를 때만 수집합니다. 기존 Apify 연결을 사용하며, 검색 수집 1회 최대 $1, 콘텐츠 수집 1회 최대 $2 한도를 적용합니다.</p>
          <div className="border-t pt-4"><h2 className="mb-2 text-sm font-semibold">저장된 분석</h2><p className="mb-2 text-xs text-slate-500">이 계정의 현재 브라우저에 최대 8개 저장</p><select aria-label="저장된 분석" className={field} value={openName} onChange={e => setOpenName(e.target.value)}><option value="">분석 선택</option>{saved.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}</select><div className="mt-2 flex gap-2"><button className={button} disabled={!openName || busy || !!pending} onClick={load}>열기</button><button className={button} disabled={!openName || busy || !!pending} onClick={() => { setSaved(current => current.filter(s => s.name !== openName)); setOpenName(""); }}>삭제</button></div><input aria-label="분석 저장 이름" placeholder="저장 이름" className={`${field} mt-3`} value={name} onChange={e => setName(e.target.value)} maxLength={60} /><button className={`${button} mt-2 w-full`} disabled={!result || busy || !!pending} onClick={save}>현재 분석 저장·갱신</button></div>
        </aside>
        <section className="min-w-0 space-y-5">
          <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm leading-relaxed text-slate-600"><b className="text-slate-800">Google Trends 상대 관심도 0–100</b><p className="mt-1">100은 선택한 검색어·국가·수집 기간에서 가장 높은 관심도입니다. 실제 검색 횟수, 연령별 검색량, 누적 검색량은 제공되지 않습니다. 급등 기준을 계산하기 위해 시작일 전 28일도 함께 수집합니다.</p><a className="mt-2 inline-block text-xs text-blue-600 hover:underline" href="https://support.google.com/trends/answer/4365533?hl=ko" target="_blank" rel="noopener noreferrer">지표 설명 ↗</a></div>
          {!result || !config ? <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><div className="mb-3 text-4xl text-blue-200">↗</div><h2 className="font-semibold">상품과 기간을 선택해 분석을 시작하세요</h2><p className="mt-2 text-sm text-slate-500">검색 관심도 추이와 급등 이벤트가 이곳에 표시됩니다.</p><p className="mt-1 text-xs text-slate-400">낮은 검색량으로 데이터가 없으면 검색어를 넓혀 다시 확인할 수 있습니다.</p></div> : <>
            <div className="flex flex-wrap items-center justify-between gap-3"><div className="text-sm text-slate-500">{config.start} ~ {config.end} · {config.geo || "전 세계"} · {result.granularity} · 수집 {new Date(result.collectedAt).toLocaleString("ko-KR")}</div><div className="flex gap-2"><button className={button} disabled={busy} onClick={csv}>CSV</button><button className={button} disabled={busy} onClick={() => void exportExcel()}>엑셀 내보내기</button><a className={button} href={result.sourceUrl} target="_blank" rel="noopener noreferrer">Google Trends ↗</a></div></div>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">{config.groups.map((g, i) => { const s = trendSummary(result, config, i); return <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold" style={{ color: COLORS[i] }}>{g.label}</h3><div className="mt-3 flex justify-between"><div><p className="text-xs text-slate-500">최고 관심도</p><b className="text-2xl">{fmt(s.peak)}</b><p className="text-xs text-slate-400">{s.date || "유효 표본 없음"}</p></div><div className="text-right text-sm"><p>평균 {fmt(s.mean)}</p><p className="mt-1 text-xs text-slate-500">유효 표본 {s.count}개</p><p className="mt-1 text-xs text-slate-500">급등 {events.filter(e => e.group === i && !e.manual).length}건</p></div></div></div>; })}</div>
            <div className="flex flex-wrap gap-2">{config.groups.map((g, i) => <button key={g.id} aria-pressed={visible.has(i)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${visible.has(i) ? "bg-white" : "bg-slate-100 opacity-50"}`} style={{ borderColor: COLORS[i], color: COLORS[i] }} onClick={() => setVisible(current => { const next = new Set(current); if (next.has(i)) next.delete(i); else next.add(i); return next; })}>{g.label}</button>)}</div>
            <TrendChart result={result} config={config} events={events} visible={visible} />
            <div className="rounded-lg bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">{result.warnings.map(w => <p key={w}>{w}</p>)}{result.granularity !== "일별" && <p>긴 기간은 주·월 단위로 반환될 수 있습니다. 급등 날짜는 해당 관측 구간의 시작일이며 일별 피크 날짜가 아닙니다.</p>}</div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><h2 className="mb-3 text-sm font-semibold">수동 이벤트 날짜 추가</h2><div className="flex flex-wrap gap-2"><select aria-label="수동 날짜 상품" className={`${field} w-auto`} value={manualGroup} onChange={e => setManualGroup(Number(e.target.value))}>{config.groups.map((g, i) => <option key={g.id} value={i}>{g.label}</option>)}</select><input aria-label="수동 이벤트 날짜" type="date" min={config.start} max={config.end} value={manualDate} className={`${field} w-auto`} onChange={e => setManualDate(e.target.value)} /><button className={button} onClick={addManual}>날짜 추가</button>{manual.length > 0 && <button className={button} onClick={() => setManual([])}>수동 날짜 지우기</button>}</div><p className="mt-2 text-xs text-slate-500">관측값이 없는 날짜는 지수를 만들지 않고 표시만 추가합니다.</p></div>
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">급등·이벤트 상세 <span className="text-sm font-normal text-slate-400">{events.length}건</span></h2><button className={button} onClick={() => setExcluded(new Set())}>모두 선택</button></div>
            {!events.length && <p className="rounded-xl border bg-white p-6 text-sm text-slate-500">현재 기준에 맞는 급등이 없습니다. 기준을 조정하거나 수동 날짜를 추가해 콘텐츠를 조회할 수 있습니다.</p>}
            {events.map((e, i) => visible.has(e.group) && <EventCard key={e.id} event={e} index={i} config={config} selected={!excluded.has(e.id)} toggle={() => setExcluded(current => { const next = new Set(current); if (next.has(e.id)) next.delete(e.id); else next.add(e.id); return next; })} contents={contents} collect={collect} busy={busy || !!pending} />)}
            <div className="rounded-xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">Cowork 분석 프롬프트</h2><p className="mt-1 text-xs text-slate-500">선택한 이벤트와 조회 완료한 콘텐츠만 포함합니다.</p></div><button className={primary} onClick={buildPrompt}>프롬프트 생성</button></div>{prompt && <><textarea aria-label="Cowork 분석 프롬프트" readOnly value={prompt} className={`${field} mt-4 h-72 font-mono text-xs leading-5`} /><button className={`${button} mt-2`} onClick={async () => { try { await navigator.clipboard.writeText(prompt); setNotice("프롬프트를 복사했습니다."); } catch { setError("복사에 실패했습니다. 프롬프트를 선택해 직접 복사하세요."); } }}>프롬프트 복사</button></>}</div>
          </>}
        </section>
      </div>
    </div>
  </main>;
}
