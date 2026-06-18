import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/apify-webhook(.*)",
  "/api/kpi/ingest(.*)",
  "/api/sponsored-posts/sync(.*)",
  "/api/sponsored-posts/bulk(.*)",
  "/api/sponsored-posts/stats-import(.*)",
  // Vercel 크론 라우트 (각 라우트가 자체 CRON_SECRET 검사 → 미들웨어는 통과시킴)
  "/api/marketing/sync(.*)",
  "/api/screening/collect(.*)",
  "/api/monitoring/apify-collect(.*)",
  "/api/brand-metrics/collect(.*)",
  "/api/youtube-trends/collect(.*)",
  "/api/youtube-trends/webhook(.*)",
  "/api/b2b-revenue/fetch(.*)",
  "/api/brand-metrics/debug(.*)",
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
