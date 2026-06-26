import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getServerSupabase } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 공유 메모 수정/삭제 — 로그인한 누구나 (팀 스크래치패드).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const content = String(body?.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "내용이 비어 있습니다" }, { status: 400 });
  const sb = getServerSupabase();
  const { error } = await sb.from("memos").update({ content, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const sb = getServerSupabase();

  // 행 삭제 전, 이미지가 Storage 업로드 URL이면 버킷에서도 제거(고아 파일 방지).
  // 구버전 base64(data:) 이미지는 Storage에 없으므로 건너뜀.
  const { data: memo } = await sb.from("memos").select("image").eq("id", id).maybeSingle();
  const img = typeof memo?.image === "string" ? memo.image : null;
  const marker = "/storage/v1/object/public/memo-images/";
  if (img && img.includes(marker)) {
    const path = decodeURIComponent(img.split(marker)[1].split("?")[0]);
    if (path) await sb.storage.from("memo-images").remove([path]); // 실패해도 행 삭제는 진행
  }

  const { error } = await sb.from("memos").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
