/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Supabase 스키마 타입 미생성으로 인한 never 타입 에러 무시
    // 런타임 동작에는 영향 없음
    ignoreBuildErrors: true,
  },
  // Vercel 배포 시 apify-client를 명시적으로 포함
  serverComponentsExternalPackages: ['apify-client'],
  experimental: {
    // Turbopack 최적화 비활성화 (apify-client 감지 문제 해결)
    turbopackRootModules: ['apify-client'],
  },
};

export default nextConfig;
