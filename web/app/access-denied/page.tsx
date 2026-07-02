"use client";
import { SignOutButton, useUser } from "@clerk/nextjs";

// @lalasweet.kr 이외 계정으로 로그인한 사용자에게 노출되는 접근 차단 안내 페이지.
// (미들웨어에서 도메인 불일치 시 이 경로로 리다이렉트 — 공개 라우트로 등록되어 재검사 루프 없음)
export default function AccessDenied() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? "";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl shadow-sm p-8 text-center">
        <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-rose-50 grid place-items-center">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
            <path d="M12 9v4m0 4h.01M10.3 3.9L2.4 18a2 2 0 001.7 3h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"
              stroke="#e11d48" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-lg font-semibold text-gray-900">접근 권한이 없습니다</h1>
        <p className="mt-2 text-sm text-gray-500 leading-relaxed">
          이 대시보드는 <span className="font-medium text-gray-700">@lalasweet.kr</span> 계정만 이용할 수 있습니다.
          {email && (
            <><br />현재 로그인: <span className="font-medium text-gray-700">{email}</span></>
          )}
        </p>
        <p className="mt-1 text-xs text-gray-400">회사 계정으로 다시 로그인해 주세요.</p>
        <SignOutButton>
          <button className="mt-6 w-full py-2.5 rounded-lg bg-gray-900 hover:bg-gray-700 text-white text-sm font-medium transition-colors">
            로그아웃 후 다시 로그인
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
