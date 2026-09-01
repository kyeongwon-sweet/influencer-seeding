import { clerkMiddleware, createRouteMatcher, clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/access-denied(.*)",
  "/api/apify-webhook(.*)",
  "/api/slack-events(.*)",
  "/api/slack/events(.*)",
  "/api/slack/injibot-action(.*)",  // injibot 부정댓글 버튼(자체 서명검증) → 미들웨어 통과
  "/api/meta/instagram-comments(.*)", // Meta IG 댓글 Webhook(HMAC 서명검증) → 미들웨어 통과
  "/api/kpi/ingest(.*)",
  "/api/kpi/fetch(.*)",
  "/api/sponsored-posts/bulk(.*)",
  "/api/sponsored-posts/stats-import(.*)",
  "/api/sponsored-posts/list-for-sheet(.*)",
  "/api/sponsored-posts/stats-for-sheet(.*)",
  "/api/sponsored-posts/tracking-by-url(.*)",
  "/api/sponsored-posts/formula-audit(.*)",  // 수식 전수감사 크론(자체 CRON_SECRET 검사)
  "/api/ops/schedule-heartbeat(.*)",         // 크로스 프로바이더 스케줄 하트비트(Apps Script/외부 핑, 자체 CRON_SECRET 검사)
  "/api/ops/collect-fallback(.*)",           // 자정수집 폴백(구글 트리거가 호출, 자체 CRON_SECRET 검사)
  "/api/ops/audit-fallback(.*)",             // 아침 수식감사 폴백(구글 트리거가 호출, 자체 CRON_SECRET 검사)
  "/api/ops/ensure-daily-audits(.*)",        // 아침 감사 보장(구글 트리거가 호출, 자체 CRON_SECRET 검사)
  "/api/ops/ensure-daily-report(.*)",        // 리포트 결과 워치독(구글 트리거가 호출, 자체 CRON_SECRET 검사)
  "/api/ops/collection-status(.*)",          // 시트 역채움 전 자정수집 완료 확인(자체 CRON_SECRET 검사)
  "/api/ops/linked-sheet-values(.*)",        // 비공개 연동시트 고정범위 읽기(자체 CRON_SECRET 검사)
  "/api/ops/db-sheet-sync-alert(.*)",         // DB→시트 독립 동기화 실패 알림(자체 CRON_SECRET 검사)
  "/api/ops/repair-metric-contamination(.*)", // 승인된 8/27 오염 정리(정확키·날짜·값 가드 + CRON_SECRET)
  "/api/sponsored-posts/banner-reach-sync(.*)",
  // Vercel 크론 라우트 (각 라우트가 자체 CRON_SECRET 검사 → 미들웨어는 통과시킴)
  "/api/marketing/sync(.*)",
  "/api/monitoring/apify-collect(.*)",
  "/api/brand-metrics/collect(.*)",
  "/api/youtube-trends/collect(.*)",
  "/api/youtube-trends/webhook(.*)",
  "/api/google-trends/collect(.*)",
  "/api/google-trends/webhook(.*)",
  "/api/b2b-revenue/fetch(.*)",
  "/api/awareness-ads(.*)",
]);

const isAdminPage = createRouteMatcher([
  "/listup(.*)",
  "/screening(.*)",
  "/contact(.*)",
]);

// 회사 도메인 화이트리스트 — 이 도메인 이메일 계정만 대시보드/API 접근 허용.
const ALLOWED_EMAIL_DOMAIN = "@lalasweet.kr";

/**
 * 사용자 이메일 캐시 — **모든 탭이 느린 원인 1번**이었다.
 *
 * 미들웨어는 공개 라우트가 아닌 **모든 요청**에 걸린다. 페이지 1회 이동에 API 호출이 여러 번
 * 붙는데(홈은 7개), 매 요청마다 `clerkClient().users.getUser()`로 **Clerk에 네트워크 왕복**을
 * 했다. 즉 홈 한 번 열 때 Clerk 왕복 8회가 모든 응답 앞에 직렬로 붙었다.
 *
 * 세션 검증(`auth.protect()`)은 JWT 로컬 검증이라 네트워크가 없다. 네트워크는 이 조회뿐이므로
 * userId별로 짧게 캐시한다. 도메인 판정용이라 이메일이 바뀌는 일이 거의 없고, 바뀌어도
 * 최대 TTL만큼만 늦게 반영된다.
 */
const EMAIL_TTL_MS = 10 * 60 * 1000;
const EMAIL_CACHE_MAX = 500;                      // 무한 증식 방지(엣지 아이솔레이트 메모리)
const emailCache = new Map<string, { email: string; at: number }>();

function cachedEmail(userId: string): string | null {
  const hit = emailCache.get(userId);
  if (!hit) return null;
  if (Date.now() - hit.at > EMAIL_TTL_MS) {
    emailCache.delete(userId);
    return null;
  }
  return hit.email;
}

function rememberEmail(userId: string, email: string) {
  // 가장 오래된 항목부터 버린다(Map은 삽입 순서 보장).
  if (emailCache.size >= EMAIL_CACHE_MAX) {
    const oldest = emailCache.keys().next().value;
    if (oldest !== undefined) emailCache.delete(oldest);
  }
  emailCache.set(userId, { email, at: Date.now() });
}

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return;

  // 1) 로그인 여부 (미로그인 → 자동 sign-in 리다이렉트)
  await auth.protect({
    unauthenticatedUrl: new URL("/sign-in", request.url).toString(),
  });

  // 2) 회사 도메인 검사 — @lalasweet.kr 계정만 통과, 그 외는 차단.
  const { userId } = await auth();
  if (!userId) return; // protect 통과 후엔 항상 존재(방어적)

  let email = cachedEmail(userId) ?? "";
  if (!email) {
    try {
      const user = await (await clerkClient()).users.getUser(userId);
      email = (
        user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ??
        user.emailAddresses[0]?.emailAddress ??
        ""
      ).toLowerCase();
      if (email) rememberEmail(userId, email);
    } catch (e) {
      // Clerk 조회 일시 실패 시 잠그지 않고 통과(장애로 정상 사용자까지 락아웃 방지). 로그만 남김.
      console.error("[middleware] 사용자 이메일 조회 실패 — 도메인 검사 생략:", e);
      return;
    }
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

  // 관리자 작업 화면은 주소를 직접 입력해도 서버 경계에서 차단한다.
  if (isAdminPage(request) && !isAdminEmail(email)) {
    const url = request.nextUrl.clone();
    url.pathname = "/access-denied";
    url.search = "";
    url.searchParams.set("reason", "admin");
    return NextResponse.redirect(url);
  }
});

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)", "/(api|trpc)(.*)"],
};
