import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeChannelType } from "@/app/monitoring/lib";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  // ended_at: 대시보드 수동 종료/해제(날짜 문자열 = 종료, null = 해제)
  const allowed = ["project_name", "product_name", "channel_type", "account_name", "company_name", "posted_at", "notes", "content_summary", "ended_at"];
  const allowedNumeric = ["cost", "reach_count"];
  const updates: Record<string, string | number | null> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key] || null;
  }
  if (typeof updates.channel_type === "string") updates.channel_type = normalizeChannelType(updates.channel_type);
  for (const key of allowedNumeric) {
    if (key in body) {
      const v = body[key];
      updates[key] = v === "" || v == null ? null : Number(v);
    }
  }
  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: "수정할 필드가 없습니다" }, { status: 400 });

  const supabase = getServerSupabase();

  // auto:true = 시스템 자동 쓰기(예: 수집 후 도달수 자동 계산).
  // ① manual_fields에 이미 잠긴 필드는 자동 쓰기가 덮지 않음(사람이 넣은 도달수 보존)
  // ② 자동 쓰기는 manual_fields에 기록하지 않음(자동 값이 '수동 수정'으로 잠기는 오염 방지)
  const isAuto = body.auto === true;
  if (isAuto) {
    const { data: cur } = await supabase
      .from("sponsored_posts").select("manual_fields").eq("id", id).single();
    const manual = new Set<string>(((cur as { manual_fields?: string[] } | null)?.manual_fields) ?? []);
    for (const k of Object.keys(updates)) if (manual.has(k)) delete updates[k];
    if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true, skipped: "manual_fields" });
  }

  const { error } = await supabase.from("sponsored_posts").update(updates).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 대시보드에서 직접 수정한 필드를 manual_fields에 누적 → 시트 자동 동기화가 덮어쓰지 않게 보존.
  // (manual_fields 컬럼이 아직 없으면 graceful skip — 마이그레이션 전 호환)
  if (!isAuto) {
    const { data: cur, error: selErr } = await supabase
      .from("sponsored_posts").select("manual_fields").eq("id", id).single();
    if (!selErr) {
      const manual = new Set<string>(((cur as { manual_fields?: string[] } | null)?.manual_fields) ?? []);
      // 캡션 포함 모든 수동 편집 필드를 잠금 → 시트 동기화가 덮지 않음(대시보드 마지막 수정 보존).
      // 시트가 빈칸이면 애초에 시트 동기화가 그 필드를 안 건드리고, 캡션 빈 건 needsCaption 자동 불러오기가 채움.
      for (const k of Object.keys(updates)) manual.add(k);
      await supabase.from("sponsored_posts").update({ manual_fields: [...manual] }).eq("id", id);
    }
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
