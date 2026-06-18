"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function HelpModal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!mounted) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    const frame = requestAnimationFrame(() => {
      if (drawerRef.current) drawerRef.current.style.transform = "translateX(0)";
    });
    return () => {
      window.removeEventListener("keydown", handler);
      cancelAnimationFrame(frame);
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  // 포털로 body 직속 렌더 → 부모 쌓임 맥락에 갇히지 않아 상단 헤더(GlobalActions) 위에 확실히 표시됨.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={drawerRef}
        className="relative w-[400px] h-full bg-white flex flex-col"
        style={{
          transform: "translateX(100%)",
          transition: "transform 0.28s cubic-bezier(0.32, 0.72, 0, 1)",
          boxShadow: "-2px 0 0 rgba(0,0,0,0.06), -16px 0 48px rgba(0,0,0,0.16)",
        }}
      >
        {/* Header */}
        <div className="px-7 pt-7 pb-0 shrink-0">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[10px] font-semibold text-a-blue tracking-[0.1em] uppercase mb-1.5">사용 안내</p>
              <h2 className="font-bold text-[18px] text-a-ink tracking-tight leading-tight">{title}</h2>
            </div>
            <button
              onClick={onClose}
              className="mt-0.5 w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className="h-px bg-a-hairline" />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-7 pt-6 pb-10 space-y-6 text-sm">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function HelpSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-a-ink tracking-tight mb-2.5">{title}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

export function HelpItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] bg-a-parchment px-4 py-3">
      <p className="text-xs font-semibold text-a-ink mb-1">{label}</p>
      <p className="text-[12px] text-a-ink-muted leading-relaxed">{children}</p>
    </div>
  );
}
