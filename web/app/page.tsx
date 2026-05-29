"use client";
import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

type Influencer = { status: string; source?: string; created_at?: string; screening_metrics?: { run_at?: string }[] };
type Job = { id: string; type: string; status: string; payload?: { added?: number; screened?: number }; user_email?: string; created_at: string };

const STATUS_CONFIG = [
  { value: "pass",    label: "통과",   dot: "bg-emerald-500" },
  { value: "pending", label: "대기중", dot: "bg-gray-300" },
  { value: "hold",    label: "보류",   dot: "bg-amber-400" },
  { value: "reject",  label: "탈락",   dot: "bg-red-400" },
];

const JOB_TYPE: Record<string, string> = { listup: "리스트업", screening: "스크리닝", monitoring: "모니터링" };

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
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function DashboardPage() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/influencers").then(r => r.json()).then(setInfluencers),
      fetch("/api/jobs").then(r => r.json()).then(setJobs),
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
      href: "/screening",
      step: "02",
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
      step: "03",
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
        <span className="text-a-ink text-sm font-semibold tracking-tight">인플루언서 시딩 트래킹 대시보드</span>
        <div className="flex items-center gap-2">
          <a
            href="https://www.youtube.com/shorts"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 text-[11px] font-medium text-a-ink hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            <svg width="14" height="10" viewBox="0 0 26 18" fill="none">
              <rect width="26" height="18" rx="4" fill="#FF0000"/>
              <polygon points="10,4 10,14 20,9" fill="white"/>
            </svg>
            YouTube Shorts
          </a>
          <a
            href="https://www.instagram.com/reels/"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-gray-200 text-[11px] font-medium text-a-ink hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
              <defs>
                <linearGradient id="ig-reels" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
                  <stop offset="0" stopColor="#F09433"/>
                  <stop offset="0.35" stopColor="#E6683C"/>
                  <stop offset="0.5" stopColor="#DC2743"/>
                  <stop offset="0.65" stopColor="#CC2366"/>
                  <stop offset="1" stopColor="#BC1888"/>
                </linearGradient>
              </defs>
              <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#ig-reels)"/>
              <circle cx="12" cy="12" r="5.5" stroke="white" strokeWidth="2"/>
              <circle cx="17.5" cy="6.5" r="1.5" fill="white"/>
            </svg>
            Instagram Reels
          </a>
          <UserButton />
        </div>
      </header>

      <main className="px-8 py-8 w-full max-w-[860px] mx-auto space-y-5">

        {/* 마지막 업데이트 시각 */}
        {!loading && (lastListupAt || lastScreeningAt) && (
          <div className="flex items-center gap-4 px-1">
            {lastListupAt && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-a-ink-muted">리스트업</span>
                <span className="text-[11px] font-semibold text-a-ink tabular-nums">{formatTimestamp(lastListupAt)}</span>
              </div>
            )}
            {lastListupAt && lastScreeningAt && (
              <span className="text-a-hairline text-xs">·</span>
            )}
            {lastScreeningAt && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-a-ink-muted">스크리닝</span>
                <span className="text-[11px] font-semibold text-a-ink tabular-nums">{formatTimestamp(lastScreeningAt)}</span>
              </div>
            )}
          </div>
        )}

        {/* 인플루언서 현황 */}
        <div className="bg-white rounded-[24px] shadow-[0_2px_24px_rgba(100,120,180,0.09)] overflow-hidden">
          <div className="px-7 pt-6 pb-2">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-a-blue inline-block" />
              <p className="text-[11px] font-semibold text-a-ink-muted tracking-widest uppercase">인플루언서 현황</p>
            </div>
          </div>
          {loading ? (
            <div className="px-7 pb-7 pt-3 flex gap-6">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 w-20 bg-a-divider rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex divide-x divide-a-hairline px-4 pb-7 pt-3">
              <div className="flex-1 px-5 py-1">
                <div className="text-[48px] font-bold tracking-tight text-a-ink leading-none">{total}</div>
                <div className="text-xs text-a-ink-muted mt-2">전체</div>
              </div>
              {STATUS_CONFIG.map(s => (
                <div key={s.value} className="flex-1 px-5 py-1">
                  <div className="text-[48px] font-bold tracking-tight text-a-ink leading-none">{counts[s.value]}</div>
                  <div className="flex items-center gap-1.5 mt-2">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
                    <span className="text-xs text-a-ink-muted">{s.label}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 워크플로우 메뉴 카드 */}
        <div className="grid grid-cols-3 gap-4">
          {menuItems.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="group bg-white rounded-[22px] shadow-[0_2px_20px_rgba(100,120,180,0.08)] p-5 flex flex-col gap-2.5 hover:-translate-y-1 hover:shadow-[0_8px_36px_rgba(100,120,180,0.16)] transition-all duration-200 ease-out"
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
          <div className="bg-white rounded-[24px] shadow-[0_2px_24px_rgba(100,120,180,0.09)] overflow-hidden">
            <div className="px-7 pt-6 pb-3">
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-a-ink-muted inline-block" />
                <p className="text-[11px] font-semibold text-a-ink-muted tracking-widest uppercase">최근 작업</p>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {jobs.map(job => {
                const js = JOB_STATUS_CONFIG[job.status] ?? { label: job.status, color: "text-a-ink-muted bg-a-divider" };
                const count = job.status === "done"
                  ? job.payload?.added != null ? `${job.payload.added}건 추가`
                  : job.payload?.screened != null ? `${job.payload.screened}건 처리`
                  : null
                  : null;
                return (
                  <div key={job.id} className="px-7 py-3.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-sm font-medium text-a-ink">{JOB_TYPE[job.type] ?? job.type}</span>
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${js.color}`}>{js.label}</span>
                      {count && <span className="text-xs text-a-ink-muted">{count}</span>}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {job.user_email && (
                        <span className="text-xs text-gray-400 hidden sm:block truncate max-w-[140px]">{job.user_email}</span>
                      )}
                      <span className="text-xs text-gray-400 whitespace-nowrap">{relativeTime(job.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
