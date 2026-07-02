"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { CHANNEL_TYPES } from "@/app/monitoring/lib";

// 모바일 전용 경량 게시물 추가 화면. 무거운 모니터링 대시보드를 로드하지 않고
// 폰에서 URL만 붙여넣어 바로 추가할 수 있게 한다. (사이드바 없이 전체 폭 — AppShell BARE_ROUTES)
// 저장 로직은 모니터링 모달의 addPost와 동일: POST /api/sponsored-posts (단건).
const EMPTY = { url: "", product_name: "", project_name: "", channel_type: "", cost: "", content_summary: "" };

export default function MobileAddPage() {
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

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
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMsg({ ok: false, text: `추가 실패: ${(err as { error?: string }).error ?? "오류가 발생했습니다."}` });
        return;
      }
      // 성공 → 폼 초기화, 연속 추가 편하게 URL로 포커스.
      setForm(EMPTY);
      setMsg({ ok: true, text: "게시물이 추가됐습니다. 계정명·게시일·캡션은 다음 수집 때 자동으로 채워집니다." });
      urlRef.current?.focus();
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

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-a-ink-muted mb-1">게시물 URL <span className="text-rose-500">*필수</span></label>
            <input ref={urlRef} inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              placeholder="https://www.instagram.com/p/..." value={form.url} onChange={set("url")}
              className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-medium text-a-ink-muted mb-1">채널 분류</label>
            <select value={form.channel_type} onChange={set("channel_type")} className={inputCls}>
              <option value="">채널 분류 선택</option>
              {CHANNEL_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
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
      </div>
    </div>
  );
}
