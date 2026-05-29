"use client";
import { useState, useCallback } from "react";

type ToastType = "success" | "error" | "info";
export type ToastItem = { id: number; message: string; type: ToastType };

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const show = useCallback((message: string, type: ToastType = "info") => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3200);
  }, []);

  return { toasts, show };
}

export function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col-reverse gap-2 items-center pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl text-sm font-medium shadow-[0_8px_32px_rgba(0,0,0,0.10)] animate-toast-in whitespace-nowrap ${
            t.type === "error" ? "bg-red-600 text-white" : "bg-white border border-blue-100 text-a-blue"
          }`}
        >
          {t.type === "success" && <span className="text-a-blue">✓</span>}
          {t.type === "error"   && <span className="text-red-200">✕</span>}
          {t.type === "info"    && <span className="text-a-blue/50">→</span>}
          {t.message}
        </div>
      ))}
    </div>
  );
}
