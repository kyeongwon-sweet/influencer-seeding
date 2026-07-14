import { clerkMiddleware, createRouteMatcher, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/access-denied(.*)",
  "/api/apify-webhook(.*)",
  "/api/slack-events(.*)",
  "/api/slack/events(.*)",
  "/api/kpi/ingest(.*)",
  "/api/kpi/fetch(.*)",
  "/api/sponsored-posts/bulk(.*)",
  "/api/sponsored-posts/stats-import(.*)",
  "/api/sponsored-posts/list-for-sheet(.*)",
  "/api/sponsored-posts/stats-for-sheet(.*)",
  // Vercel 크론 라우트 (각 라우트가 자체 CRON_SECRET 검사 → 미들웨어는 통과시킴)
  "/api/marketing/sync(.*)",
  "/api/monitoring/apify-collect(.*)",
  "/api/brand-metrics/collect(.*)",
  "/api/youtube-trends/collect(.*)",
  "/api/youtube-trends/webhook(.*)",
  "/api/b2b-revenue/fetch(.*)",
  "/api/awareness-ads(.*)",
]);

// 회사 도메인 화이트리스트 — 이 도메인 이메일 계정만 대시보드/API 접근 허용.
const ALLOWED_EMAIL_DOMAIN = "@lalasweet.kr";

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  // 1) 로그인 여부 (미로그인 → 자동 sign-in 리다이렉트)
  await auth.protect();

  // 2) 회사 도메인 검사 — @lalasweet.kr 계정만 통과, 그 외는 차단.
  const { userId } = await auth();
  if (!userId) return; // protect 통과 후엔 항상 존재(방어적)

  let email = "";
  try {
    const user = await (await clerkClient()).users.getUser(userId);
    email = (
      user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ??
      user.emailAddresses[0]?.emailAddress ??
      ""
    ).toLowerCase();
  } catch (e) {
    // Clerk 조회 일시 실패 시 잠그지 않고 통과(장애로 정상 사용자까지 락아웃 방지). 로그만 남김.
    console.error("[middleware] 사용자 이메일 조회 실패 — 도메인 검사 생략:", e);
    return;
  }

  if (!email.endsWith(ALLOWED_EMAIL_DOMAIN)) {
    // API는 403 JSON, 페이지는 안내 페이지로 리다이렉트(로그인 상태라 sign-in 무한 리다이렉트 방지 위해 별도 페이지).
    if (request.nextUrl.pathname.startsWith("/api")) {
      return NextResponse.json(
        { error: `접근 권한이 없습니다. ${ALLOWED_EMAIL_DOMAIN} 계정만 이용할 수 있습니다.` },
        { status: 403 }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/access-denied";
    url.search = "";
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
