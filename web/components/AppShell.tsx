"use client";
import { usePathname } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import GlobalActions from "@/components/GlobalActions";

// 사이드바 없이 전체 폭으로 보여줄 경로(모바일 전용 화면 등).
const BARE_ROUTES = ["/mobile-add"];

// 앱 크롬(사이드바 + 상단 액션 + 본문 여백)을 경로에 따라 조건부로 렌더.
// BARE_ROUTES에선 크롬 없이 children만 전체 폭으로 → 폰에서 편하게 사용.
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (BARE_ROUTES.includes(pathname)) return <>{children}</>;
  return (
    <>
      <Sidebar />
      <GlobalActions />
      <div className="sidebar-content" style={{ marginLeft: "var(--sidebar-w, 200px)" }}>{children}</div>
    </>
  );
}
