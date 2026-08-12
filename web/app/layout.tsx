import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";
import AppShell from "@/components/AppShell";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  title: "인지 트래킹 대시보드",
  description: "라라스윗 인지 트래킹 관리",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      {/* 아래 head 스크립트가 하이드레이션 전에 <html>의 --sidebar-w를 심어 SSR 결과와
          달라진다(의도된 동작 = 사이드바 폭 깜빡임 방지). 그 속성 불일치만 억제한다. */}
      <html lang="ko" suppressHydrationWarning>
        <head>
          {/* 사이드바 너비를 페인트 전에 복원해 본문이 깜빡이지 않게 함 */}
          <script
            dangerouslySetInnerHTML={{
              __html: `try{var c=localStorage.getItem('sidebar-collapsed')==='1';var w=Number(localStorage.getItem('sidebar-w'))||200;if(w<160)w=160;if(w>360)w=360;document.documentElement.style.setProperty('--sidebar-w',(c?56:w)+'px');}catch(e){}`,
            }}
          />
        </head>
        <body className="antialiased font-sans text-a-ink">
          <AppShell>{children}</AppShell>
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
