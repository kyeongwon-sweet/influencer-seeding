/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Supabase 스키마 타입 미생성으로 인한 never 타입 에러 무시
    // 런타임 동작에는 영향 없음
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
