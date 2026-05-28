import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "인플루언서 시딩 시스템",
  description: "라라스윗 인플루언서 시딩 관리",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="ko">
        <body className={`antialiased font-sans bg-a-parchment text-a-ink ${inter.variable}`}>
          <Sidebar />
          <div className="ml-[200px]">{children}</div>
        </body>
      </html>
    </ClerkProvider>
  );
}
