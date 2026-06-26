"use client";
import { useState, useEffect, useCallback } from "react";

type Memo = { id: string; content: string; author: string | null; image?: string | null; created_at: string; updated_at: string };

function fmtTime(iso: string): string {
  const k = new Date(new Date(iso).getTime() + 9 * 3600 * 1000); // KST
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}

// 붙여넣은 이미지를 data URI로 → 서버가 Supabase Storage 업로드. 원본급(최대 2560px·JPEG q0.92).
async function resizeToDataUrl(file: File, max = 2560, quality = 0.92): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return c.toDataURL("image/jpeg", quality);
}

// 사이드바에 고정 노출되는 팀 공유 메모(포스트잇). /api/memos 사용.
export default function SidebarMemo() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [draft, setDraft] = useState("");
  const [draftImg, setDraftImg] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState(false);
  const [zoomImg, setZoomImg] = useState<string | null>(null);

  async function onPaste(e: React.ClipboardEvent) {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/"));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    e.preventDefault();
    try { setDraftImg(await resizeToDataUrl(file)); } catch { setErr(true); }
  }

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/memos", { cache: "no-store" });
      if (r.ok) { setMemos(await r.json()); setErr(false); } else setErr(true);
    } catch { setErr(true); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000); // 팀원 메모 반영
    return () => clearInterval(t);
  }, [load]);

  async function add() {
    const content = draft.trim();
    if (!content && !draftImg) return;
    const img = draftImg;
    setDraft(""); setDraftImg(null);
    const r = await fetch("/api/memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, image: img }) });
    if (r.ok) { const m = await r.json(); setMemos(prev => [m, ...prev]); } else { setDraft(content); setDraftImg(img); setErr(true); }
  }
  async function del(id: string) {
    setMemos(prev => prev.filter(x => x.id !== id));
    await fetch(`/api/memos/${id}`, { method: "DELETE" });
  }
  async function saveEdit() {
    if (!editing) return;
    const { id, text } = editing; const content = text.trim();
    setEditing(null);
    if (!content) return;
    setMemos(prev => prev.map(x => x.id === id ? { ...x, content } : x));
    await fetch(`/api/memos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
  }

  return (
    <>
    <div className="flex-1 min-h-0 flex flex-col border-t border-gray-100 mt-1">
      <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1.5 shrink-0">
        <span className="text-[11px] font-semibold text-gray-500 tracking-wide">📝 메모 <span className="font-normal text-gray-300">· 팀 공유</span></span>
        <button onClick={load} title="새로고침" className="w-5 h-5 grid place-items-center rounded text-gray-300 hover:text-a-ink hover:bg-gray-100 text-xs">↻</button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 space-y-1.5">
        {err && <p className="text-[11px] text-rose-500 px-1">불러오기 실패 (테이블 생성 확인)</p>}
        {!err && memos.length === 0 && <p className="text-[11px] text-gray-300 px-1 py-2">메모가 없어요.</p>}
        {memos.map(m => (
          <div key={m.id} className="group/m relative rounded-[8px] bg-amber-50 border border-amber-200/70 px-2.5 py-1.5">
            {editing?.id === m.id ? (
              <textarea autoFocus value={editing.text}
                onChange={e => setEditing({ id: m.id, text: e.target.value })}
                onBlur={saveEdit}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit(); if (e.key === "Escape") setEditing(null); }}
                className="w-full text-[12px] text-a-ink resize-none outline-none bg-transparent leading-snug" rows={3} />
            ) : (
              <p onClick={() => setEditing({ id: m.id, text: m.content })}
                className="text-[12px] text-a-ink whitespace-pre-wrap break-words leading-snug cursor-text">{m.content}</p>
            )}
            {m.image && (
              <img src={m.image} alt="첨부 이미지" onClick={() => setZoomImg(m.image!)}
                className="mt-1 max-h-28 w-auto rounded border border-amber-200 object-contain cursor-zoom-in" />
            )}
            <div className="flex items-center justify-between mt-1 gap-1">
              <span className="text-[10px] text-amber-700/55 truncate">{m.author || "익명"} · {fmtTime(m.created_at)}</span>
              <button onClick={() => del(m.id)} title="삭제"
                className="opacity-0 group-hover/m:opacity-100 transition-opacity text-[10px] text-rose-400 hover:text-rose-600 shrink-0">삭제</button>
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 p-2.5">
        {draftImg && (
          <div className="relative inline-block mb-1">
            <img src={draftImg} alt="붙여넣은 이미지" className="max-h-16 w-auto rounded border border-gray-200" />
            <button onClick={() => setDraftImg(null)} title="이미지 제거"
              className="absolute -top-1.5 -right-1.5 w-4 h-4 grid place-items-center rounded-full bg-gray-700 hover:bg-gray-900 text-white text-[10px] leading-none">×</button>
          </div>
        )}
        <textarea value={draft} onChange={e => setDraft(e.target.value)} onPaste={onPaste}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add(); }}
          placeholder="메모… (이미지 붙여넣기 가능 · ⌘/Ctrl+Enter)"
          className="w-full text-[12px] text-a-ink bg-white border border-gray-200 rounded-[7px] px-2 py-1.5 resize-none outline-none focus:border-amber-400 leading-snug" rows={2} />
        <button onClick={add} disabled={!draft.trim()}
          className="mt-1 w-full text-[11px] font-medium bg-amber-300 hover:bg-amber-400 disabled:opacity-40 text-amber-900 rounded-[6px] py-1 transition-colors">추가</button>
      </div>
    </div>
    {zoomImg && (
      <div className="fixed inset-0 z-[100] bg-black/80 p-4 cursor-zoom-out"
        onClick={() => setZoomImg(null)}>
        {/* w-full h-full + object-contain: 작은 이미지도 화면을 채우도록 확대(비율 유지) */}
        <img src={zoomImg} alt="첨부 이미지 확대" className="w-full h-full object-contain" />
      </div>
    )}
    </>
  );
}
