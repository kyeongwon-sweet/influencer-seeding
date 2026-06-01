"use client";
import { UserButton } from "@clerk/nextjs";

export default function GlobalActions() {
  return (
    <div className="fixed top-0 right-0 z-[60] h-11 flex items-center gap-2 px-4">
      <a
        href="https://www.youtube.com/shorts"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-gray-100 shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-[11px] font-semibold text-a-ink hover:shadow-[0_4px_14px_rgba(0,0,0,0.13)] transition-all duration-150 whitespace-nowrap"
      >
        <svg width="14" height="10" viewBox="0 0 26 18" fill="none">
          <rect width="26" height="18" rx="4" fill="#FF0000"/>
          <polygon points="10,4 10,14 20,9" fill="white"/>
        </svg>
        YouTube Shorts
      </a>
      <a
        href="https://www.instagram.com/reels/"
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-gray-100 shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-[11px] font-semibold text-a-ink hover:shadow-[0_4px_14px_rgba(0,0,0,0.13)] transition-all duration-150 whitespace-nowrap"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <defs>
            <linearGradient id="ig-reels-global" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#F09433"/>
              <stop offset="0.35" stopColor="#E6683C"/>
              <stop offset="0.5" stopColor="#DC2743"/>
              <stop offset="0.65" stopColor="#CC2366"/>
              <stop offset="1" stopColor="#BC1888"/>
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="22" height="22" rx="6" fill="url(#ig-reels-global)"/>
          <circle cx="12" cy="12" r="5.5" stroke="white" strokeWidth="2"/>
          <circle cx="17.5" cy="6.5" r="1.5" fill="white"/>
        </svg>
        Instagram Reels
      </a>
      <UserButton />
    </div>
  );
}
