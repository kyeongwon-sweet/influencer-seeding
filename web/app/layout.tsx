import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "인플루언서 시딩 트래킹 대시보드",
  description: "라라스윗 인플루언서 시딩 관리",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="ko">
        <body className="antialiased font-sans text-a-ink">
          <Sidebar />
          <div className="ml-[200px]">{children}</div>
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
