"use client";
import { useState, useEffect, useRef, useCallback } from "react";

type Memo = { id: string; content: string; author: string | null; created_at: string; updated_at: string };

const POS_KEY = "memoPanelPos";
const OPEN_KEY = "memoPanelOpen";

function fmtTime(iso: string): string {
  const k = new Date(new Date(iso).getTime() + 9 * 3600 * 1000); // KST
  const mm = k.getUTCMonth() + 1, dd = k.getUTCDate();
  const hh = String(k.getUTCHours()).padStart(2, "0"), mi = String(k.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

export default function MemoPanel() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [memos, setMemos] = useState<Memo[]>([]);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [err, setErr] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // 초기 위치·열림 상태 복원 (마운트 후 — SSR 안전)
  useEffect(() => {
    try {
      const p = localStorage.getItem(POS_KEY);
      setPos(p ? JSON.parse(p) : { x: Math.max(12, window.innerWidth - 360), y: 96 });
      setOpen(localStorage.getItem(OPEN_KEY) === "1");
    } catch { setPos({ x: 100, y: 96 }); }
  }, []);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/memos", { cache: "no-store" });
      if (r.ok) { setMemos(await r.json()); setErr(false); } else setErr(true);
    } catch { setErr(true); }
  }, []);

  // 열려 있는 동안 로드 + 20초마다 갱신(팀원 메모 반영)
  useEffect(() => {
    if (!open) return;
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [open, load]);

  function setOpenP(v: boolean) { setOpen(v); try { localStorage.setItem(OPEN_KEY, v ? "1" : "0"); } catch {} }

  function onDragStart(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest("button")) return; // 헤더 버튼 클릭은 드래그 아님
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    const move = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const x = Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dragRef.current.dx));
      const y = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dragRef.current.dy));
      setPos({ x, y });
    };
    const up = () => {
      dragRef.current = null;
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      setPos(p => { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch {} return p; });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  }

  async function add() {
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    const r = await fetch("/api/memos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
    if (r.ok) { const m = await r.json(); setMemos(prev => [m, ...prev]); } else { setDraft(content); setErr(true); }
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

  if (!open) {
    return (
      <button onClick={() => setOpenP(true)}
        className="fixed bottom-5 right-5 z-[55] flex items-center gap-1.5 rounded-full bg-amber-300 hover:bg-amber-400 text-amber-900 text-xs font-semibold px-4 py-2.5 shadow-[0_4px_16px_rgba(180,140,0,0.3)] transition-colors">
        📝 메모{memos.length > 0 ? ` ${memos.length}` : ""}
      </button>
    );
  }

  return (
    <div className="fixed z-[55] w-[320px] max-h-[70vh] flex flex-col rounded-[14px] bg-amber-50 border border-amber-200 shadow-[0_8px_30px_rgba(120,90,0,0.18)] overflow-hidden"
      style={{ left: pos.x, top: pos.y }}>
      {/* 헤더(드래그 핸들) */}
      <div onMouseDown={onDragStart} className="flex items-center justify-between px-3.5 py-2 bg-amber-200/70 cursor-move select-none">
        <span className="text-xs font-bold text-amber-900">📝 메모 <span className="font-normal text-amber-700/70">· 팀 공유</span></span>
        <div className="flex items-center gap-1">
          <button onClick={load} title="새로고침" className="w-6 h-6 grid place-items-center rounded hover:bg-amber-300/60 text-amber-800 text-sm">↻</button>
          <button onClick={() => setOpenP(false)} title="닫기" className="w-6 h-6 grid place-items-center rounded hover:bg-amber-300/60 text-amber-800 text-base leading-none">×</button>
        </div>
      </div>

      {/* 메모 목록 */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-2">
        {err && <p className="text-[11px] text-rose-600">불러오기 실패 — 새로고침(↻) 또는 테이블 생성 여부 확인</p>}
        {!err && memos.length === 0 && <p className="text-[11px] text-amber-700/70 text-center py-4">아직 메모가 없어요. 아래에 적어보세요.</p>}
        {memos.map(m => (
          <div key={m.id} className="group/memo relative rounded-[10px] bg-white border border-amber-200 px-3 py-2 shadow-sm">
            {editing?.id === m.id ? (
              <textarea autoFocus value={editing.text}
                onChange={e => setEditing({ id: m.id, text: e.target.value })}
                onBlur={saveEdit}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveEdit(); if (e.key === "Escape") setEditing(null); }}
                className="w-full text-xs text-a-ink resize-none outline-none bg-transparent leading-relaxed" rows={3} />
            ) : (
              <p onClick={() => setEditing({ id: m.id, text: m.content })}
                className="text-xs text-a-ink whitespace-pre-wrap break-words leading-relaxed cursor-text">{m.content}</p>
            )}
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[11px] text-amber-700/60">{m.author || "익명"} · {fmtTime(m.created_at)}</span>
              <button onClick={() => del(m.id)} title="삭제"
                className="opacity-0 group-hover/memo:opacity-100 transition-opacity text-[11px] text-rose-400 hover:text-rose-600">삭제</button>
            </div>
          </div>
        ))}
      </div>

      {/* 입력 */}
      <div className="border-t border-amber-200 p-2.5 bg-amber-100/50">
        <textarea value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add(); }}
          placeholder="메모 입력… (Ctrl/⌘+Enter로 추가)"
          className="w-full text-xs text-a-ink bg-white border border-amber-200 rounded-[8px] px-2.5 py-2 resize-none outline-none focus:border-amber-400 leading-relaxed" rows={2} />
        <div className="flex justify-end mt-1.5">
          <button onClick={add} disabled={!draft.trim()}
            className="text-xs font-medium bg-amber-400 hover:bg-amber-500 disabled:opacity-40 text-amber-950 rounded-[7px] px-3 py-1 transition-colors">추가</button>
        </div>
      </div>
    </div>
  );
}
