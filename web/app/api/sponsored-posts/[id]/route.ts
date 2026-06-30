import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const allowed = ["project_name", "product_name", "channel_type", "account_name", "posted_at", "notes", "content_summary"];
  const allowedNumeric = ["cost", "reach_count"];
  const updates: Record<string, string | number | null> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key] || null;
  }
  for (const key of allowedNumeric) {
    if (key in body) {
      const v = body[key];
      updates[key] = v === "" || v == null ? null : Number(v);
    }
  }
  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "수정할 필드가 없습니다" }, { status: 400 });

  const supabase = getServerSupabase();
  const { error } = await supabase.from("sponsored_posts").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 대시보드에서 직접 수정한 필드를 manual_fields에 누적 → 시트 자동 동기화가 덮어쓰지 않게 보존.
  // (manual_fields 컬럼이 아직 없으면 graceful skip — 마이그레이션 전 호환)
  const { data: cur, error: selErr } = await supabase
    .from("sponsored_posts").select("manual_fields").eq("id", id).single();
  if (!selErr) {
    const manual = new Set<string>(((cur as { manual_fields?: string[] } | null)?.manual_fields) ?? []);
    // 캡션은 시트값 우선 정책 → manual로 잠그지 않음(시트 동기화가 항상 덮을 수 있게).
    for (const k of Object.keys(updates)) if (k !== "content_summary") manual.add(k);
    await supabase.from("sponsored_posts").update({ manual_fields: [...manual] }).eq("id", id);
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = getServerSupabase();
  const { error } = await supabase
    .from("sponsored_posts")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}
