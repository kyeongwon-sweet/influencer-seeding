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
  // 붙여넣기 이미지(data URI). 작은 이미지만 — 너무 크면 거부(DB 보호). 클라에서 축소해서 보냄.
  const image = typeof body?.image === "string" && body.image.startsWith("data:image/") ? body.image : null;
  if (image && image.length > 700_000) return NextResponse.json({ error: "이미지가 너무 큽니다" }, { status: 413 });
  if (!content && !image) return NextResponse.json({ error: "내용이 비어 있습니다" }, { status: 400 });

  const u = await currentUser();
  const author = (u?.fullName || u?.firstName || u?.username
    || u?.emailAddresses?.[0]?.emailAddress || "익명").toString();

  const sb = getServerSupabase();
  const row: Record<string, unknown> = { content, author };
  if (image) row.image = image; // 이미지 있을 때만 — image 컬럼 없으면 텍스트 메모는 영향 없음(이미지 메모만 ALTER 필요)
  const { data, error } = await sb.from("memos").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
