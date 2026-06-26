import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 공유 메모(포스트잇) — 로그인한 누구나 보고/작성. memos 테이블(scripts/create_memos_table.sql) 필요.
export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = getServerSupabase();
  // select("*") — image 컬럼 추가(ALTER) 전에도 안전(없으면 그냥 미포함, 에러 안 남)
  const { data, error } = await sb
    .from("memos")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? [], { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const content = String(body?.content ?? "").trim();
  // 붙여넣기 이미지(data URI) → Supabase Storage 업로드 후 URL만 DB에 저장(원본급 화질, DB 비대화 방지).
  const image = typeof body?.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
  if (image && image.length > 6_000_000) return NextResponse.json({ error: "이미지가 너무 큽니다" }, { status: 413 }); // ~4.5MB(API 본문 한도)
  if (!content && !image) return NextResponse.json({ error: "내용이 비어 있습니다" }, { status: 400 });

  const u = await currentUser();
  const author = (u?.fullName || u?.firstName || u?.username
    || u?.emailAddresses?.[0]?.emailAddress || "익명").toString();

  const sb = getServerSupabase();
  let imageUrl: string | null = null;
  if (image) {
    const m = image.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (!m) return NextResponse.json({ error: "이미지 형식 오류" }, { status: 400 });
    const ext = m[1] === "image/png" ? "png" : m[1] === "image/gif" ? "gif" : m[1] === "image/webp" ? "webp" : "jpg";
    const buf = Buffer.from(m[2], "base64");
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const up = await sb.storage.from("memo-images").upload(path, buf, { contentType: m[1], upsert: false });
    if (up.error) return NextResponse.json({ error: "이미지 업로드 실패: " + up.error.message }, { status: 500 });
    imageUrl = sb.storage.from("memo-images").getPublicUrl(path).data.publicUrl;
  }
  const row: Record<string, unknown> = { content, author };
  if (imageUrl) row.image = imageUrl; // Storage 공개 URL (구버전 base64도 src에서 그대로 표시됨)
  const { data, error } = await sb.from("memos").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
