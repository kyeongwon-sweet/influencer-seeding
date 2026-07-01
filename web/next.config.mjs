import { execSync } from "node:child_process";

// 코드 마지막 수정 시각(사이드바 표기용). 마지막 커밋 시각을 우선 쓰고, git 조회 실패 시 빌드 시각으로 폴백.
// 빌드 시 1회 평가되어 NEXT_PUBLIC_BUILD_TIME으로 인라인 → 배포(코드 변경)마다 자동 갱신.
let buildTime;
try {
  buildTime = execSync("git log -1 --format=%cI").toString().trim();
} catch {
  buildTime = new Date().toISOString();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_TIME: buildTime,
  },
  typescript: {
    // 타입 에러 시 빌드 실패시킴 — import 누락 등 런타임 크래시(client-side exception)를
    // 배포 전에 잡기 위함. (2026-06-29: LineChart URL 상수 import 누락이 그대로 배포돼
    // 그래프 호버 시 페이지가 죽은 사고 재발방지.) 끄지 말 것. 끄면 npm build가 타입 에러를
    // 통과시킴. 푸시 전 `npx tsc --noEmit`로도 확인 가능.
    ignoreBuildErrors: false,
  },
  eslint: {
    // 빌드 시 ESLint 에러로 배포가 막히지 않도록 (Next 15는 기본으로 빌드 중 lint 실행)
    // 런타임 동작에는 영향 없음
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
