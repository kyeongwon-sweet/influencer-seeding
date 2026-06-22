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
  const { data, error } = await sb
    .from("memos")
    .select("id, content, author, created_at, updated_at")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? [], { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const content = String(body?.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "내용이 비어 있습니다" }, { status: 400 });

  const u = await currentUser();
  const author = (u?.fullName || u?.firstName || u?.username
    || u?.emailAddresses?.[0]?.emailAddress || "익명").toString();

  const sb = getServerSupabase();
  const { data, error } = await sb.from("memos").insert({ content, author }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
