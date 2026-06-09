"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Influencer = { name: string; status: string; source?: string; created_at?: string; screening_metrics?: { run_at?: string; kw_impact?: number | null; kw_keywords?: string | null }[] };
type OrganicMention = { id: string; created_at: string; platform: string; account_name: string | null; mentioned_product: string | null; view_count: number | null };
type Job = { id: string; type: string; status: string; payload?: { added?: number; screened?: number }; user_email?: string; created_at: string; error?: string };
type DailyStats = { play_count: number | null; comments_count: number | null; measured_at: string };
type SponsoredPost = { id: string; url: string | null; account_name: string | null; project_name: string | null; influencers: { name: string } | null; latest_stats: DailyStats | null; prev_stats: DailyStats | null };
type KpiMetric = { label: string; target: number | null; current: number | null; achievement: number | null };
type KpiSnapshot = { id: string; fetched_at: string; month_label: string | null; metrics: KpiMetric[] };

const STATUS_CONFIG = [
  { value: "pass",    label: "통과",   dot: "bg-emerald-500" },
  { value: "pending", label: "대기중", dot: "bg-gray-300" },
  { value: "hold",    label: "보류",   dot: "bg-amber-400" },
  { value: "reject",  label: "탈락",   dot: "bg-red-400" },
];

const JOB_TYPE: Record<string, string> = { listup: "리스트업", organic: "무상 노출", organic_refresh: "무상 노출 조회수 갱신", screening: "스크리닝", monitoring: "모니터링" };

const JOB_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  done:    { label: "완료",   color: "text-emerald-600 bg-emerald-50" },
  running: { label: "실행중", color: "text-a-blue bg-blue-50" },
  pending: { label: "대기",   color: "text-a-ink-muted bg-a-divider" },
  failed:  { label: "실패",   color: "text-red-600 bg-red-50" },
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relativeTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  if (isToday) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtKpi(v: number | null): string {
  if (v == null) return "-";
  if (typeof v !== 'number' || isNaN(v)) return String(v);
  const abs = Math.abs(v);
  if (abs >= 100_000_000) return (v / 100_000_000).toFixed(1).replace(/\.0$/, "") + "억";
  if (abs >= 100_000)     return Math.round(v / 10_000) + "만";
  return v.toLocaleString();
}

export default function DashboardPage() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [posts, setPosts] = useState<SponsoredPost[]>([]);
  const [organicMentions, setOrganicMentions] = useState<OrganicMention[]>([]);
  const [kpi, setKpi] = useState<KpiSnapshot | null>(null);
  const [brandSearch, setBrandSearch] = useState<{ date: string; value: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllJobs, setShowAllJobs] = useState(false);

  useEffect(() => {
    const t = AbortSignal.timeout(12000);
    Promise.allSettled([
      fetch("/api/influencers", { signal: t }).then(r => r.json()).then(setInfluencers),
      fetch("/api/jobs", { signal: t }).then(r => r.json()).then(setJobs),
      fetch("/api/sponsored-posts", { signal: t }).then(r => r.json()).then((data: SponsoredPost[]) => {
        if (Array.isArray(data)) setPosts(data);
      }),
      fetch("/api/organic-mentions", { signal: t }).then(r => r.json()).then((data: OrganicMention[]) => {
        if (Array.isArray(data)) setOrganicMentions(data);
      }),
      fetch("/api/kpi", { signal: t }).then(r => r.json()).then((data: KpiSnapshot | null) => {
        if (data?.id) setKpi(data);
      }),
      fetch("/api/product-search-trends", { signal: t }).then(r => r.json()).then((d: { brandKey?: string; data?: { date: string; values: Record<string, number | null> }[] }) => {
        if (d?.brandKey && Array.isArray(d.data)) {
          const key = d.brandKey;
          setBrandSearch(
            d.data
              .map(row => ({ date: row.date, value: row.values[key] }))
              .filter((x): x is { date: string; value: number } => x.value != null)
          );
        }
      }),
    ]).finally(() => setLoading(false));
  }, []);

  const lastListupAt = influencers.length > 0
    ? influencers.map(i => i.created_at).filter(Boolean).sort().reverse()[0] ?? null
    : null;
  const allMetricsRunAt = influencers.flatMap(i => (i.screening_metrics ?? []).map(m => m.run_at));
  const lastScreeningAt = allMetricsRunAt.length > 0
    ? allMetricsRunAt.filter(Boolean).sort().reverse()[0] ?? null
    : null;

  const total = influencers.length;
  const counts = Object.fromEntries(
    STATUS_CONFIG.map(s => [s.value, influencers.filter(i => i.status === s.value).length])
  );

  const topViewGainers = posts
    .filter(p => p.prev_stats != null && p.latest_stats != null)
    .map(p => ({ post: p, delta: (p.latest_stats!.play_count ?? 0) - (p.prev_stats!.play_count ?? 0) }))
    .filter(x => x.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);

  const topCommentGainers = posts
    .filter(p => p.prev_stats != null && p.latest_stats != null)
    .map(p => ({ post: p, delta: (p.latest_stats!.comments_count ?? 0) - (p.prev_stats!.comments_count ?? 0) }))
    .filter(x => x.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);

  const kwSpikes = influencers
    .flatMap(inf => (inf.screening_metrics ?? [])
      .filter(m => m.kw_impact != null && Math.abs(m.kw_impact!) >= 20)
      .map(m => ({ inf, kw_impact: m.kw_impact!, kw_keywords: m.kw_keywords ?? null }))
    )
    .sort((a, b) => Math.abs(b.kw_impact) - Math.abs(a.kw_impact))
    .slice(0, 3);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentOrganic = organicMentions.filter(m => m.created_at >= sevenDaysAgo).slice(0, 3);

  // 라라스윗 전체 검색량 급등: 최신일 vs 전전일(2일 전), +30% 이상이면 노출
  const brandSpike = (() => {
    if (brandSearch.length < 3) return null;
    const sorted = [...brandSearch].sort((a, b) => a.date.localeCompare(b.date));
    const latest = sorted[sorted.length - 1];
    const target = new Date(new Date(latest.date + "T00:00:00").getTime() - 2 * 86400000).toISOString().slice(0, 10);
    const prev2 = sorted.find(x => x.date === target) ?? sorted[sorted.length - 3];
    if (!prev2 || prev2.value <= 0) return null;
    const pct = ((latest.value - prev2.value) / prev2.value) * 100;
    if (pct < 30) return null;
    return { pct, latest, prev2 };
  })();

  const menuItems = [
    {
      href: "/listup",
      step: "01",
      label: "리스트업",
      desc: "해시태그로 인플루언서 계정 발굴",
      stat: !loading && total > 0 ? `${total.toLocaleString()}명 발굴됨` : null,
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-a-ink">
          <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
          <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      href: "/organic",
      step: "02",
      label: "무상 노출",
      desc: "라라스윗 언급 게시물 자동 수집",
      stat: null,
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-a-ink">
          <path d="M10 3C6.69 3 4 5.69 4 9c0 2.12 1.08 3.99 2.72 5.1L6 17h8l-.72-2.9C14.92 12.99 16 11.12 16 9c0-3.31-2.69-6-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
          <path d="M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      href: "/screening",
      step: "03",
      label: "스크리닝",
      desc: "지표 확인 및 협찬 후보 선정",
      stat: !loading && counts.pass > 0 ? `통과 ${counts.pass}명` : null,
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-a-ink">
          <rect x="2" y="4" width="16" height="2.5" rx="1.25" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="2" y="8.75" width="11" height="2.5" rx="1.25" stroke="currentColor" strokeWidth="1.5"/>
          <rect x="2" y="13.5" width="7" height="2.5" rx="1.25" stroke="currentColor" strokeWidth="1.5"/>
        </svg>
      ),
    },
    {
      href: "/monitoring",
      step: "04",
      label: "협찬 모니터링",
      desc: "게시물 일별 성과 자동 추적",
      stat: null,
      icon: (
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-a-ink">
          <polyline points="2,14 6,9 10,11 14,5 18,7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <img src="/lalasweet-logo.png" alt="라라스윗" className="h-5 w-auto object-contain" />
          <span className="text-a-ink text-[20px] font-bold tracking-tight">인플루언서 시딩 트래킹 대시보드</span>
        </div>
        <div />
      </header>

      <main className="px-10 py-8 w-full max-w-[1080px] mx-auto space-y-5">


        {/* 오늘의 인사이트 */}
        {!loading && (
          <div className="bg-white rounded-[24px] shadow-[0_4px_32px_rgba(100,120,180,0.13)] overflow-hidden">
            <div className="px-7 pt-6 pb-3">
              <div className="inline-flex items-center gap-1.5 bg-green-50 rounded-full px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                <p className="text-[11px] font-semibold text-green-600 tracking-widest uppercase">오늘의 인사이트</p>
              </div>
            </div>
            <div className="px-7 pb-5 grid grid-cols-2 gap-x-8 gap-y-5">
              <div>
                <p className="text-[11px] font-bold text-a-ink mb-2">📈 조회수 급상승</p>
                {topViewGainers.length > 0 ? (
                  <div className="space-y-0.5">
                    {topViewGainers.map(({ post, delta }, i) => (
                      <a key={post.id} href={post.url ?? undefined} target="_blank" rel="noreferrer"
                        className="flex items-center justify-between gap-2 hover:bg-a-parchment rounded-[6px] py-1 -mx-1 px-1 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] text-a-ink-muted tabular-nums w-4 flex-shrink-0">{i + 1}</span>
                          <span className="text-xs font-medium text-a-ink truncate">
                            {post.influencers?.name ?? post.account_name ?? "-"}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-red-500 whitespace-nowrap flex-shrink-0">
                          +{delta.toLocaleString()}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-a-ink-muted">특이사항 없음</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold text-a-ink mb-2">💬 댓글 급상승</p>
                {topCommentGainers.length > 0 ? (
                  <div className="space-y-0.5">
                    {topCommentGainers.map(({ post, delta }, i) => (
                      <a key={post.id} href={post.url ?? undefined} target="_blank" rel="noreferrer"
                        className="flex items-center justify-between gap-2 hover:bg-a-parchment rounded-[6px] py-1 -mx-1 px-1 transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] text-a-ink-muted tabular-nums w-4 flex-shrink-0">{i + 1}</span>
                          <span className="text-xs font-medium text-a-ink truncate">
                            {post.influencers?.name ?? post.account_name ?? "-"}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-red-500 whitespace-nowrap flex-shrink-0">
                          +{delta.toLocaleString()}
                        </span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-a-ink-muted">특이사항 없음</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold text-a-ink mb-2">🔍 검색량 특이치</p>
                {(brandSpike || kwSpikes.length > 0) ? (
                  <div className="space-y-1">
                    {brandSpike && (
                      <div className="flex items-center justify-between gap-2 bg-red-50 rounded-[6px] px-2 py-1 -mx-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-bold text-red-600 whitespace-nowrap">🔥 라라스윗 전체 급등</span>
                          <span className="text-[10px] text-a-ink-muted truncate hidden sm:block">
                            · {brandSpike.prev2.date.slice(5).replace("-", "/")}→{brandSpike.latest.date.slice(5).replace("-", "/")}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-red-500 whitespace-nowrap flex-shrink-0">
                          +{brandSpike.pct.toFixed(0)}%
                        </span>
                      </div>
                    )}
                    {kwSpikes.map(({ inf, kw_impact, kw_keywords }, i) => (
                      <div key={i} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] text-a-ink-muted tabular-nums w-4 flex-shrink-0">{i + 1}</span>
                          <span className="text-xs font-medium text-a-ink truncate">{inf.name}</span>
                          {kw_keywords && <span className="text-[10px] text-a-ink-muted truncate hidden sm:block">· {kw_keywords}</span>}
                        </div>
                        <span className={`text-xs font-semibold whitespace-nowrap flex-shrink-0 ${kw_impact > 0 ? "text-red-500" : "text-emerald-600"}`}>
                          {kw_impact > 0 ? "+" : ""}{kw_impact.toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-a-ink-muted">특이사항 없음</p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold text-a-ink mb-2">💡 무상 노출</p>
                {recentOrganic.length > 0 ? (
                  <div className="space-y-0.5">
                    {recentOrganic.map((m, i) => (
                      <div key={m.id} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] text-a-ink-muted tabular-nums w-4 flex-shrink-0">{i + 1}</span>
                          <span className="text-xs font-medium text-a-ink truncate">{m.account_name ?? "-"}</span>
                          {m.mentioned_product && <span className="text-[10px] text-a-ink-muted truncate hidden sm:block">· {m.mentioned_product}</span>}
                        </div>
                        <span className="text-xs text-a-ink whitespace-nowrap flex-shrink-0">
                          {m.view_count != null ? m.view_count.toLocaleString() : "-"}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-a-ink-muted">특이사항 없음</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* KPI 현황 */}
        <div className="bg-white rounded-[24px] shadow-[0_4px_32px_rgba(100,120,180,0.13)] overflow-hidden">
          <div className="px-7 pt-6 pb-2 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-1.5 bg-blue-50 rounded-full px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-a-blue inline-block" />
                <p className="text-[11px] font-semibold text-a-blue tracking-widest uppercase">
                  {kpi?.month_label ? `${kpi.month_label} ` : ""}KPI 현황
                </p>
              </div>
              <a
                href="https://docs.google.com/spreadsheets/d/1QpUgPdiZGXtgXnRnDld99Kp1qP0rRbqwyv0aYbJ_Omo/edit?gid=1808124579#gid=1808124579"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-a-blue hover:underline whitespace-nowrap"
              >
                마케팅 현황과 연동 →
              </a>
            </div>
            {kpi?.fetched_at && (
              <span className="text-[11px] text-a-ink-muted">
                업데이트 <span className="font-medium text-a-ink">{formatTimestamp(kpi.fetched_at)}</span>
              </span>
            )}
          </div>
          {loading ? (
            <div className="px-7 pb-7 pt-3 flex gap-4">
              {[...Array(7)].map((_, i) => <div key={i} className="h-16 flex-1 bg-a-divider rounded-lg animate-pulse" />)}
            </div>
          ) : kpi ? (
            <div className="flex divide-x divide-a-hairline px-4 pb-7 pt-3 overflow-x-auto">
              {kpi.metrics.map((m, i) => {
                const pct = m.achievement;
                const pctColor = pct == null ? "text-a-ink-muted" : pct >= 100 ? "text-emerald-600" : pct >= 70 ? "text-amber-500" : "text-red-500";
                return (
                  <div key={i} className="flex-1 min-w-[120px] px-4 py-1">
                    <div className="text-[11px] text-a-ink-muted mb-1.5 whitespace-nowrap">{m.label}</div>
                    <div className="text-[22px] font-bold tracking-tight text-a-ink leading-none tabular-nums whitespace-nowrap">
                      {fmtKpi(m.current)}
                    </div>
                    <div className="text-[11px] text-a-ink-muted mt-2 truncate">
                      목표 {fmtKpi(m.target)}
                    </div>
                    <div className={`text-xs font-semibold mt-0.5 ${pctColor}`}>
                      {pct != null ? `${pct}%` : "-"}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="px-7 pb-7 pt-3 text-sm text-a-ink-muted">
              KPI 데이터가 없습니다.{" "}
              <span className="text-[11px]">Supabase에 <code className="bg-a-parchment px-1 rounded">kpi_snapshots</code> 테이블 생성 후 <code className="bg-a-parchment px-1 rounded">/api/kpi/fetch</code>를 호출해 주세요.</span>
            </div>
          )}
        </div>

        {/* 워크플로우 메뉴 카드 */}
        <div className="grid grid-cols-4 gap-4">
          {menuItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="group bg-white rounded-[22px] shadow-[0_4px_24px_rgba(100,120,180,0.11)] p-5 flex flex-col gap-2.5 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(100,120,180,0.20)] transition-all duration-200 ease-out"
            >
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-[10px] bg-slate-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                  {item.icon}
                </div>
                <span className="text-[11px] font-semibold text-a-ink-muted/30 tabular-nums">{item.step}</span>
              </div>
              <div>
                <div className="text-sm font-semibold text-a-ink tracking-tight">{item.label}</div>
                <div className="text-xs text-a-ink-muted mt-0.5 leading-relaxed">{item.desc}</div>
              </div>
              {item.stat && (
                <div className="text-xs font-medium text-a-blue">{item.stat}</div>
              )}
            </Link>
          ))}
        </div>

        {/* 최근 작업 */}
        {!loading && jobs.length > 0 && (
          <div className="bg-white rounded-[24px] shadow-[0_4px_32px_rgba(100,120,180,0.13)] overflow-hidden">
            <div className="px-7 pt-6 pb-3">
              <div className="inline-flex items-center gap-1.5 bg-gray-100 rounded-full px-3 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-a-ink-muted inline-block" />
                <p className="text-[11px] font-semibold text-a-ink-muted tracking-widest uppercase">최근 작업</p>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {(showAllJobs ? jobs : jobs.slice(0, 10)).map(job => {
                const js = JOB_STATUS_CONFIG[job.status] ?? { label: job.status, color: "text-a-ink-muted bg-a-divider" };
                const count = job.status === "done"
                  ? job.payload?.added != null ? `${job.payload.added}건 추가`
                  : job.payload?.screened != null ? `${job.payload.screened}건 처리`
                  : null
                  : null;
                return (
                  <div key={job.id} className="px-7 py-3.5 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-sm font-medium text-a-ink">{JOB_TYPE[job.type] ?? job.type}</span>
                        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${js.color}`}>{js.label}</span>
                        {count && <span className="text-xs text-a-ink-muted">{count}</span>}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        {job.user_email
                          ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-medium whitespace-nowrap">직접 실행</span>
                          : <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 font-medium whitespace-nowrap">자동 실행</span>
                        }
                        {job.user_email && (
                          <span className="text-xs text-gray-400 hidden sm:block truncate max-w-[140px]">{job.user_email}</span>
                        )}
                        <span className="text-xs text-gray-400 whitespace-nowrap">{relativeTime(job.created_at)}</span>
                      </div>
                    </div>
                    {job.status === "failed" && job.error && (
                      <p className="text-[11px] text-red-400 leading-snug pl-0.5 break-all">{job.error}</p>
                    )}
                  </div>
                );
              })}
            </div>
            {jobs.length > 10 && (
              <button
                onClick={() => setShowAllJobs(prev => !prev)}
                className="w-full py-3 text-xs text-a-ink-muted hover:text-a-ink hover:bg-a-parchment transition-colors border-t border-gray-50"
              >
                {showAllJobs ? "접기 ↑" : `+ 더보기 (${jobs.length - 10}개)`}
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
