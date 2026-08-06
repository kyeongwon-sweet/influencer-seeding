import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { logger } from "@/lib/logger";
import { platformFromUrl } from "@/lib/platform";
import { enrichSupported, runActorSync, pickViewCount, pickUploadedAt, pickCaption, pickThumbnail, productsFromCaption } from "@/lib/organic-enrich";

// Apify 동기 실행이 최대 100초라 넉넉히 잡는다(다른 수집 라우트도 60~300을 쓴다).
export const maxDuration = 120;

/**
 * 무상노출 단건 자동 보강 — 게시일 · 채널 유형 · 언급 제품 · 조회수.
 * 수동 추가 직후 화면이 fire-and-forget으로 호출한다(추가 자체를 막지 않는다).
 *
 * 안전 규칙
 *  · **빈 칸만 채운다.** 사람이 넣은 값은 절대 덮지 않는다.
 *  · 조회수는 **기존값보다 클 때만** 쓴다(역행 금지 — 수집 오류가 실측을 깎지 못하게).
 *  · 못 알아낸 항목은 그냥 비워둔다(지어내지 않는다).
 */
export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });

  const supabase = getServerSupabase();
  const { data: row, error } = await supabase
    .from("organic_mentions")
    .select("id,url,platform,uploaded_at,view_count,mentioned_product,thumbnail_url")
    .eq("id", id)
    .single();
  if (error || !row) return NextResponse.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });

  // 채널 유형: 저장값이 비어 있으면 URL로 판정한다(여기서 채우는 것도 '자동 업데이트'의 일부).
  const platform = row.platform || platformFromUrl(row.url) || "";
  if (!enrichSupported(platform)) {
    return NextResponse.json({ enriched: false, reason: `보강 미지원 플랫폼(${platform || "미분류"})`, patch: platform && !row.platform ? { platform } : {} });
  }

  let items: Record<string, unknown>[] = [];
  try {
    items = await runActorSync(platform, row.url);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error("organic-enrich", "Apify 실행 실패", { id, platform, error: message });
    // 실패해도 추가 자체는 이미 됐다 → 200으로 알리고 사람이 나중에 채울 수 있게 한다.
    return NextResponse.json({ enriched: false, reason: `수집 실패: ${message}`, patch: {} });
  }
  const item = items[0];
  if (!item) {
    return NextResponse.json({ enriched: false, reason: "수집 결과 없음(비공개·삭제·미지원 링크일 수 있음)", patch: {} });
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const patch: Record<string, unknown> = {};
  if (!row.platform && platform) patch.platform = platform;
  if (!row.uploaded_at) {
    const d = pickUploadedAt(item, todayISO);
    if (d) patch.uploaded_at = d;
  }
  if (!row.thumbnail_url) {
    // 만료되는 호스트(인스타 CDN 등)는 pickThumbnail이 걸러낸다 → 깨질 이미지는 저장하지 않는다.
    const thumb = pickThumbnail(item);
    if (thumb) patch.thumbnail_url = thumb;
  }
  const views = pickViewCount(item);
  // 역행 금지: 기존값이 있으면 더 큰 값일 때만 갱신한다.
  if (views != null && (row.view_count == null || views > Number(row.view_count))) patch.view_count = views;

  if (!row.mentioned_product) {
    // 이미 쓰이는 이름만 후보로 쓴다 → 새 표기가 생겨 칩이 난립하는 일을 막는다.
    const { data: all } = await supabase.from("organic_mentions").select("mentioned_product").not("mentioned_product", "is", null);
    const known = [...new Set((all ?? []).flatMap((r) => String(r.mentioned_product ?? "").split(",").map((s) => s.trim()).filter(Boolean)))];
    const found = productsFromCaption(pickCaption(item), known);
    if (found.length) patch.mentioned_product = found.join(", ");
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ enriched: false, reason: "채울 빈 칸이 없거나 값을 못 찾음", patch: {} });
  }

  const { error: upErr } = await supabase.from("organic_mentions").update(patch).eq("id", id);
  if (upErr) {
    logger.error("organic-enrich", "업데이트 실패", { id, error: upErr.message });
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }
  logger.info("organic-enrich", "보강 완료", { id, platform, fields: Object.keys(patch) });
  return NextResponse.json({ enriched: true, patch });
}
