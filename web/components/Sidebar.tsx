"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import SidebarMemo from "./SidebarMemo";

const MIN_W = 160, MAX_W = 360, DEFAULT_W = 200, COLLAPSED_W = 56;

// 코드 마지막 수정(배포) 시각 — next.config가 빌드 시 커밋 시각을 인라인. KST로 포맷(sv-SE=ISO형).
const BUILD_TIME = (() => {
  const raw = process.env.NEXT_PUBLIC_BUILD_TIME;
  if (!raw) return "";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
})();

const NAV = [
  {
    href: "/",
    label: "홈",
    icon: (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
        <path d="M3 9.5L10 3l7 6.5V17a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M7.5 18V13h5v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    href: "/listup",
    label: "리스트업",
    icon: (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
        <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M13 13l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/organic",
    label: "무상 노출",
    icon: (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
        <path d="M10 3C6.69 3 4 5.69 4 9c0 2.12 1.08 3.99 2.72 5.1L6 17h8l-.72-2.9C14.92 12.99 16 11.12 16 9c0-3.31-2.69-6-6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
        <path d="M8 17h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/screening",
    label: "스크리닝",
    icon: (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
        <rect x="2" y="4" width="16" height="2.5" rx="1.25" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="2" y="8.75" width="11" height="2.5" rx="1.25" stroke="currentColor" strokeWidth="1.5"/>
        <rect x="2" y="13.5" width="7" height="2.5" rx="1.25" stroke="currentColor" strokeWidth="1.5"/>
      </svg>
    ),
  },
  {
    href: "/contact",
    label: "인플루언서 컨택",
    icon: (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
        <circle cx="8" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M2 17c0-3.314 2.686-5 6-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        <path d="M13.5 12.5h5M16 10v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    href: "/monitoring",
    label: "협찬 모니터링",
    icon: (
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
        <polyline points="2,14 6,9 10,11 14,5 18,7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [width, setWidth] = useState(DEFAULT_W);
  const [collapsed, setCollapsed] = useState(false);
  const widthRef = useRef(DEFAULT_W);

  // 저장된 너비/접힘 상태 복원
  useEffect(() => {
    const w = Number(localStorage.getItem("sidebar-w"));
    if (w >= MIN_W && w <= MAX_W) { setWidth(w); widthRef.current = w; }
    setCollapsed(localStorage.getItem("sidebar-collapsed") === "1");
  }, []);

  const effectiveW = collapsed ? COLLAPSED_W : width;

  // 본문 여백(--sidebar-w)과 동기화
  useEffect(() => {
    document.documentElement.style.setProperty("--sidebar-w", `${effectiveW}px`);
  }, [effectiveW]);

  const toggleCollapsed = () => {
    setCollapsed(c => {
      const next = !c;
      localStorage.setItem("sidebar-collapsed", next ? "1" : "0");
      return next;
    });
  };

  // 오른쪽 경계 드래그로 너비 조절
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    document.body.classList.add("sb-dragging"); // 드래그 중 transition 비활성(즉시 추종)
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(MAX_W, Math.max(MIN_W, ev.clientX));
      widthRef.current = w;
      setWidth(w);
    };
    const onUp = () => {
      document.body.classList.remove("sb-dragging");
      localStorage.setItem("sidebar-w", String(widthRef.current));
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return (
    <aside
      className="sidebar-aside fixed left-0 top-0 h-screen bg-white flex flex-col z-50 shadow-[1px_0_0_0_#e4e8f0]"
    >
      {/* 접기/펴기 토글 */}
      <div className={`flex items-center ${collapsed ? "justify-center" : "justify-end"} px-2 pt-3 pb-1`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          title={collapsed ? "메뉴 펼치기" : "메뉴 접기"}
          className="w-7 h-7 flex items-center justify-center rounded-[7px] text-gray-400 hover:text-a-ink hover:bg-gray-100 transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
            {collapsed
              ? <path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              : <path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />}
          </svg>
        </button>
      </div>

      <nav className="px-2.5 pt-1 pb-3 space-y-0.5 overflow-x-hidden shrink-0">
        {NAV.map(item => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}
              className={`flex items-center gap-2.5 ${collapsed ? "justify-center px-0" : "px-3"} py-2 rounded-[8px] text-sm transition-colors ${
                isActive
                  ? "bg-blue-50 text-a-blue font-medium"
                  : "text-gray-400 hover:text-a-ink hover:bg-gray-50"
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* 모니터링 페이지에선 사이드바 빈 공간에 팀 공유 메모를 기본 노출. 그 외엔 스페이서로 푸터를 하단 고정 */}
      {!collapsed && pathname.startsWith("/monitoring")
        ? <SidebarMemo />
        : <div className="flex-1" />}

      {!collapsed && (
        <div className="px-5 py-4 border-t border-gray-100 shrink-0">
          <p className="text-[11px] text-gray-300 tracking-wide">트래킹 대시보드 v1</p>
          {BUILD_TIME && (
            <p className="text-[10px] text-gray-300 tracking-wide mt-0.5">코드 업데이트: {BUILD_TIME}</p>
          )}
        </div>
      )}

      {/* 드래그 리사이즈 핸들 (접힘 상태에선 숨김) */}
      {!collapsed && (
        <div
          onMouseDown={onDragStart}
          title="드래그하여 너비 조절"
          className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-a-blue/20 active:bg-a-blue/30 transition-colors"
        />
      )}
    </aside>
  );
}
