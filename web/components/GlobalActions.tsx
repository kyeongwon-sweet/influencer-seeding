"use client";
import { UserButton } from "@clerk/nextjs";

const CHIP_CLS = "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white border border-gray-100 shadow-[0_2px_8px_rgba(0,0,0,0.08)] text-[11px] font-semibold text-a-ink hover:shadow-[0_4px_14px_rgba(0,0,0,0.13)] transition-all duration-150 whitespace-nowrap";

function LinkChip({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={CHIP_CLS}>
      {icon}
      {label}
    </a>
  );
}

export default function GlobalActions() {
  return (
    <div className="fixed top-0 right-0 z-[60] h-11 flex items-center gap-2 px-4">
      <LinkChip
        href="https://www.tiktok.com/"
        label="TikTok"
        icon={
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
            <defs>
              <path id="tt-note-global" d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 1 1-2.59-2.59c.27 0 .53.04.78.12V9.66a5.66 5.66 0 0 0-.78-.05A5.7 5.7 0 1 0 15.55 15.3V9.01a7.34 7.34 0 0 0 4.3 1.38V7.3a4.29 4.29 0 0 1-3.25-1.48z"/>
            </defs>
            <use href="#tt-note-global" fill="#25F4EE" transform="translate(-0.8 0.8)"/>
            <use href="#tt-note-global" fill="#FE2C55" transform="translate(0.8 -0.8)"/>
            <use href="#tt-note-global" fill="#010101"/>
          </svg>
        }
      />
      <LinkChip
        href="https://www.youtube.com/shorts"
        label="YouTube Shorts"
        icon={
          <svg width="14" height="10" viewBox="0 0 26 18" fill="none">
            <rect width="26" height="18" rx="4" fill="#FF0000"/>
            <polygon points="10,4 10,14 20,9" fill="white"/>
          </svg>
        }
      />
      <LinkChip
        href="https://www.instagram.com/reels/"
        label="Instagram Reels"
        icon={
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
        }
      />
      <UserButton />
    </div>
  );
}
