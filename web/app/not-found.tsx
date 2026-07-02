// 커스텀 404 페이지.
// ⚠️ force-dynamic 필수 — 기본(정적) 404는 Cache-Control: public 이라 Vercel 엣지가 캐시함.
// 라우트 배포 전파 직전 시점의 404가 프로덕션 도메인 엣지에 고착돼 전 페이지가 404로 서빙되던
// 사고(2026-07)를 방지: 동적 렌더 → no-store 로 나가 엣지가 404를 캐시하지 못하게 한다.
export const dynamic = "force-dynamic";

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-4xl font-bold text-a-ink">404</p>
      <p className="text-sm text-a-ink-muted">페이지를 찾을 수 없습니다.</p>
      <Link href="/" className="mt-1 text-sm text-a-blue hover:underline">홈으로 가기</Link>
    </div>
  );
}
