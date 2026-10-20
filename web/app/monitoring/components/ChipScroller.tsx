"use client";
// 가로로 넘치는 칩 줄. 2026-10-20 사용자: "상품이 넘어가면 가로 스크롤 할 수 있도록 — 잘려 보이는 줄 모를 수도 있어".
//   · 넘치는 쪽 끝을 흐리게 + ‹ › 화살표(넘칠 때만 보임, 누르면 한 화면씩 이동)
//   · 마우스 세로 휠 → 가로 스크롤(칩 줄 끝에 닿으면 원래대로 페이지가 스크롤)
//   · 얇은 스크롤바를 보이게 둔다(예전엔 scrollbar-none 으로 숨겨 넘치는 줄 몰랐다)
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export default function ChipScroller({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdge(prev => {
      const next = { left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 };
      return prev.left === next.left && prev.right === next.right ? prev : next;
    });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update); // 칩 목록이 바뀌면(데이터 로딩 후) 다시 계산
    mo.observe(el, { childList: true, subtree: true });
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // 트랙패드 가로 스와이프는 브라우저에 맡김
      const max = el.scrollWidth - el.clientWidth;
      const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
      if (next === el.scrollLeft) return; // 끝에 닿았으면 페이지 스크롤로 넘긴다
      e.preventDefault();
      el.scrollLeft = next;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => { ro.disconnect(); mo.disconnect(); el.removeEventListener("wheel", onWheel); };
  }, [update]);

  const scrollByPage = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.7), behavior: "smooth" });
  };

  const arrow = "absolute top-0 bottom-1.5 flex items-center z-10";
  const knob = "w-6 h-6 rounded-full border border-a-hairline bg-white text-a-ink-muted shadow-sm flex items-center justify-center text-sm leading-none hover:text-a-blue hover:border-a-blue";

  return (
    <div className={`relative min-w-0 ${className}`}>
      <div
        ref={ref}
        onScroll={update}
        className="flex items-center gap-1.5 overflow-x-auto flex-nowrap pb-1.5 scrollbar-soft"
      >
        {children}
      </div>
      {edge.left && (
        <div className={`${arrow} left-0 pr-6 bg-gradient-to-r from-white via-white/90 to-transparent`}>
          <button type="button" aria-label="이전 상품 보기" title="이전 상품 보기" onClick={() => scrollByPage(-1)} className={knob}>‹</button>
        </div>
      )}
      {edge.right && (
        <div className={`${arrow} right-0 pl-6 bg-gradient-to-l from-white via-white/90 to-transparent`}>
          <button type="button" aria-label="다음 상품 보기" title="다음 상품 더 보기" onClick={() => scrollByPage(1)} className={knob}>›</button>
        </div>
      )}
    </div>
  );
}
