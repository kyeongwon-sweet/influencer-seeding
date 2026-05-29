"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

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

  return (
    <aside className="fixed left-0 top-0 h-screen w-[200px] bg-white flex flex-col z-50 shadow-[1px_0_0_0_#e4e8f0]">
      <div className="px-5 h-11 flex items-center border-b border-gray-100 shrink-0">
        {/* 로고 이미지: web/public/lalasweet-logo.png 에 저장 필요 */}
        <img src="/lalasweet-logo.png" alt="라라스윗" className="h-5 w-auto object-contain" />
      </div>

      <nav className="flex-1 px-2.5 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(item => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-[8px] text-sm transition-colors ${
                isActive
                  ? "bg-blue-50 text-a-blue font-medium"
                  : "text-gray-400 hover:text-a-ink hover:bg-gray-50"
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-gray-100 shrink-0">
        <p className="text-[11px] text-gray-300 tracking-wide">트래킹 대시보드 v1</p>
      </div>
    </aside>
  );
}
