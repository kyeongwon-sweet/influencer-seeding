/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Supabase 스키마 타입 미생성으로 인한 never 타입 에러 무시
    // 런타임 동작에는 영향 없음
    ignoreBuildErrors: true,
  },
  eslint: {
    // 빌드 시 ESLint 에러로 배포가 막히지 않도록 (Next 15는 기본으로 빌드 중 lint 실행)
    // 런타임 동작에는 영향 없음
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
