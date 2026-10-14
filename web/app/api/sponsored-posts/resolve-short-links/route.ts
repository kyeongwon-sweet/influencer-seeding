import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { resolveTikTokShortUrl } from "@/lib/sponsored-write";
import { isTikTokShortLink, normalizeUrl, postIdentityKey } from "@/lib/url-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_URLS = 200;
const CONCURRENCY = 8;

/**
 * 연동시트 Apps Script → 틱톡 단축링크를 정식 게시물 주소로 풀어 돌려준다(읽기 전용, DB 쓰기 없음).
 *
 * 왜: 서버(bulk·stats-import)는 단축링크를 풀어 정식 주소로 DB에 저장하지만, Apps Script `linkKey_`는
 * 못 풀어 pullFromDB가 같은 글을 정식 주소 행으로 한 번 더 추가했다(2026-10-13 위성 틱톡 8건).
 * 시트가 동기화 전에 이 라우트로 셀을 정식 주소로 바꾸면 시트↔DB 키가 처음부터 같아진다.
 * 해석 규칙은 쓰기 경로와 같은 `resolveTikTokShortUrl` 하나만 쓴다(두 벌 구현 금지).
 *
 * 인증: Authorization: Bearer <CRON_SECRET> (fail-closed).
 * 요청: { urls: string[] } (최대 200개)
 * 응답: { results: [{ input, resolved, key, reason? }] } — 못 풀면 resolved=null, 셀은 그대로 둔다.
 */
export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const urls: unknown = body?.urls;
  if (!Array.isArray(urls) || urls.some(u => typeof u !== "string")) {
    return NextResponse.json({ error: "urls 문자열 배열이 필요합니다" }, { status: 400 });
  }
  if (urls.length > MAX_URLS) {
    return NextResponse.json({ error: `한 번에 최대 ${MAX_URLS}개까지 풀 수 있습니다` }, { status: 400 });
  }

  const inputs = [...new Set((urls as string[]).map(u => u.trim()).filter(Boolean))];
  const results: Array<{ input: string; resolved: string | null; key: string | null; reason?: string }> = [];
  for (let i = 0; i < inputs.length; i += CONCURRENCY) {
    const chunk = inputs.slice(i, i + CONCURRENCY);
    results.push(...await Promise.all(chunk.map(async input => {
      if (!isTikTokShortLink(input)) return { input, resolved: null, key: null, reason: "not_short_link" };
      const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
      const location = await resolveTikTokShortUrl(withScheme);
      if (location === withScheme) return { input, resolved: null, key: null, reason: "unresolved" };
      const resolved = normalizeUrl(location) ?? location;
      const key = postIdentityKey(resolved);
      if (!key?.startsWith("tt:")) return { input, resolved: null, key: null, reason: "no_post_id" };
      return { input, resolved, key };
    })));
  }

  return NextResponse.json({
    results,
    resolved: results.filter(r => r.resolved).length,
    unresolved: results.filter(r => !r.resolved).length,
  });
}
