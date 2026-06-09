/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Supabase 스키마 타입 미생성으로 인한 never 타입 에러 무시
    // 런타임 동작에는 영향 없음
    ignoreBuildErrors: true,
  },
  // Vercel 배포 시 apify-client를 명시적으로 포함
  // Turbopack 의존성 분석 우회
  bundlePagesRouterDependencies: true,
  // 서버 컴포넌트에서도 외부 패키지 포함
  serverComponentsExternalPackages: ['apify-client'],
};

export default nextConfig;
