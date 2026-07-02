"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { CHANNEL_TYPES } from "@/app/monitoring/lib";

type RecentPost = { id: string; url: string; channel_type: string | null; content_summary: string | null; posted_at: string | null; created_at: string; created_by?: string | null };

// 추가 시각 표기 (KST, MM-DD HH:mm)
function fmtTime(iso: string) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "-";
  return d.toLocaleString("sv-SE", { timeZone: "Asia/Seoul", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// 모바일 전용 경량 게시물 추가 화면. 무거운 모니터링 대시보드를 로드하지 않고
// 폰에서 URL만 붙여넣어 바로 추가할 수 있게 한다. (사이드바 없이 전체 폭 — AppShell BARE_ROUTES)
// 저장 로직은 모니터링 모달의 addPost와 동일: POST /api/sponsored-posts (단건).
const EMPTY = { url: "", product_name: "", project_name: "", channel_type: "", cost: "", content_summary: "" };

export default function MobileAddPage() {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const { user } = useUser();
  const [history, setHistory] = useState<RecentPost[]>([]);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/sponsored-posts/recent", { cache: "no-store" });
      if (r.ok) setHistory(await r.json());
    } catch { /* 히스토리 실패는 무시(추가 기능엔 영향 없음) */ }
  }, []);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.url.trim() || submitting) return;
    setSubmitting(true);
    setMsg(null);
    try {
      const res = await fetch("/api/sponsored-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: form.url.trim(),
          product_name: form.product_name || null,
          project_name: form.project_name || null,
          channel_type: form.channel_type || null,
          cost: form.cost !== "" ? Number(form.cost) : null,
          content_summary: form.content_summary.trim() || null,
          added_by: user?.primaryEmailAddress?.emailAddress ?? null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const text = res.status === 409
          ? "이미 추가된 게시물입니다. (같은 URL은 한 번만 등록돼요)"
          : `추가 실패: ${(err as { error?: string }).error ?? "오류가 발생했습니다."}`;
        setMsg({ ok: false, text });
        return;
      }
      // 성공 → 폼 초기화, 연속 추가 편하게 URL로 포커스.
      setForm(EMPTY);
      setMsg({ ok: true, text: "게시물이 추가됐습니다. 계정명·게시일·캡션은 다음 수집 때 자동으로 채워집니다." });
      urlRef.current?.focus();
      loadHistory();
    } catch {
      setMsg({ ok: false, text: "네트워크 오류로 추가하지 못했습니다." });
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls = "w-full text-base bg-white border border-gray-300 rounded-xl px-3.5 py-3 outline-none focus:border-a-blue focus:ring-2 focus:ring-a-blue/20 transition";

  return (
    <div className="min-h-screen bg-a-parchment/40">
      <div className="mx-auto w-full max-w-md px-4 py-5">
        <header className="flex items-center justify-between mb-4">
          <h1 className="text-lg font-bold text-a-ink">게시물 추가</h1>
          <Link href="/monitoring" className="text-xs text-a-ink-muted hover:text-a-blue">대시보드 →</Link>
        </header>

        {/* 공지 메모팁 — 카카오/네이버 조회수 수동 입력 안내 */}
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-800">
          💡 <b>카카오 숏폼·네이버 클립</b>은 조회수 자동 수집이 안 됩니다. 이 두 채널은 대시보드에서 조회수를 <b>수동 입력</b>해 주세요.
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-a-ink-muted mb-1">게시물 URL <span className="text-rose-500">*필수</span></label>
            <input ref={urlRef} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              placeholder="https://www.instagram.com/reel/DZPNjIZIzRe/" value={form.url} onChange={set("url")}
              className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-medium text-a-ink-muted mb-1">채널 분류</label>
            {/* appearance-none으로 네이티브 들여쓰기/화살표 제거 → 텍스트가 다른 입력칸과 동일하게 pl-3.5 정렬. 커스텀 화살표는 오른쪽 안쪽. */}
            <div className="relative">
              <select value={form.channel_type} onChange={set("channel_type")} className={inputCls + " appearance-none pr-10"}>
                <option value="">채널 분류 선택</option>
                {CHANNEL_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-a-ink-muted">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-a-ink-muted mb-1">프로젝트명</label>
              <input placeholder="선택" value={form.project_name} onChange={set("project_name")} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-a-ink-muted mb-1">상품명</label>
              <input placeholder="선택" value={form.product_name} onChange={set("product_name")} className={inputCls} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-a-ink-muted mb-1">비용 (원)</label>
            <input inputMode="numeric" placeholder="선택" value={form.cost} onChange={set("cost")} className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-medium text-a-ink-muted mb-1">캡션</label>
            <textarea rows={3} placeholder="비워두면 수집 시 자동으로 가져옵니다" value={form.content_summary} onChange={set("content_summary")}
              className={inputCls + " resize-none"} />
          </div>

          <p className="text-[11px] text-a-ink-muted leading-relaxed">인플루언서 계정명·게시일은 수집 실행 시 자동으로 가져옵니다.</p>

          <button type="submit" disabled={!form.url.trim() || submitting}
            className="w-full text-base font-semibold rounded-xl bg-a-blue text-white py-3.5 disabled:opacity-40 active:opacity-80 transition">
            {submitting ? "추가 중…" : "추가"}
          </button>

          {msg && (
            <p className={`text-sm rounded-xl px-3.5 py-3 ${msg.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-rose-50 text-rose-600 border border-rose-200"}`}>
              {msg.text}
            </p>
          )}
        </form>

        {history.length > 0 && (
          <section className="mt-7">
            <h2 className="text-xs font-semibold text-a-ink-muted mb-2">최근 추가</h2>
            <div className="space-y-2">
              {history.map(h => (
                <div key={h.id} className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-a-ink truncate">{h.channel_type || "채널 미지정"}</span>
                    <span className="text-a-ink-muted whitespace-nowrap">{fmtTime(h.created_at)}</span>
                  </div>
                  <a href={h.url} target="_blank" rel="noreferrer" className="block text-xs text-a-blue truncate mt-1">{h.url}</a>
                  {h.content_summary && <p className="text-xs text-a-ink-muted truncate mt-1">{h.content_summary}</p>}
                  <div className="flex items-center justify-between gap-2 mt-1.5 text-[11px] text-a-ink-muted">
                    <span className="whitespace-nowrap">업로드 {h.posted_at || "-"}</span>
                    <span className="truncate">{h.created_by || "-"}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
