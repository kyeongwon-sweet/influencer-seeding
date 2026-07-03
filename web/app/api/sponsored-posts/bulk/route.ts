import { NextRequest, NextResponse } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { getServerSupabase } from "@/lib/supabase-server";
import { upsertSponsoredRows } from "@/lib/sponsored-write";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 구글 시트 Apps Script → 협찬 게시물 일괄 추가
 *
 * 인증: Authorization: Bearer <CRON_SECRET> (sponsored-posts/sync 와 동일 패턴).
 *   CRON_SECRET 미설정 시 무조건 차단(fail-closed). 시트 외 호출자가 성과 지표를
 *   조작/종료 처리하는 것을 막는다.
 *
 * 부모 라우트 `/api/sponsored-posts` 가 Vercel/Turbopack 라우팅 manifest 누락으로
 * 404가 되는 문제를 우회하기 위한 자식 라우트. (자식 라우트는 정상 배포됨)
 *
 * 요청 body: 행 배열  [{ url, posted_at?, account_name?, company_name?, content_summary?,
 *   channel_type?, project_name?, product_name?, cost? }, ...]
 * 또는 { rows: [...] } 형태도 허용.
 *
 * 플랫폼 제한 없음 (instagram / youtube / tiktok 등 모든 URL). URL만 정규화 후 upsert.
 */
export async function POST(req: NextRequest) {
  if (checkCronAuth(req) !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const list = Array.isArray(body) ? body : Array.isArray(body?.rows) ? body.rows : null;
  if (!list) {
    return NextResponse.json({ error: "행 배열(또는 {rows:[...]})이 필요합니다" }, { status: 400 });
  }

  // 쓰기 정책(정규화·플랫폼 필터·빈값만 채우기·manual_fields 보존·종료 처리)은
  // CSV 업로드(/api/sponsored-posts 배열 분기)와 공유 — lib/sponsored-write.ts 단일 구현.
  const supabase = getServerSupabase();
  const { summary, error } = await upsertSponsoredRows(supabase, list as Array<Record<string, unknown>>, "sheet-bulk");
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json({ ok: true, ...summary }, { status: 200 });
}
