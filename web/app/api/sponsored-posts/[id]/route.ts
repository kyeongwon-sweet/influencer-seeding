import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { normalizeChannelType, canonicalText } from "@/app/monitoring/lib";
import { stripAssetFileListing } from "@/lib/asset-name-policy";
import { endedAtPolicyError } from "@/lib/ended-at-policy";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  // ended_at: 대시보드 수동 종료/해제(날짜 문자열 = 종료, null = 해제)
  const allowed = ["asset_name", "project_name", "product_name", "channel_type", "account_name", "company_name", "posted_at", "notes", "content_summary", "ended_at"];
  const allowedNumeric = ["cost", "reach_count"];
  const updates: Record<string, string | number | null> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key] || null;
  }
  if (typeof updates.channel_type === "string") updates.channel_type = normalizeChannelType(updates.channel_type);
  // asset_name은 파일리스트 제거를 먼저(시트 쓰기 경로와 동일 순서 strip→canonical) — 순서 뒤바뀌면 별칭 매칭이 경로마다 달라짐
  if (typeof updates.asset_name === "string") updates.asset_name = stripAssetFileListing(updates.asset_name);
  // 이름류 텍스트는 공백·별칭 표준화(공백만 다른 중복 방지, CANONICAL_ALIASES 자가교정)
  for (const key of ["account_name", "company_name", "asset_name", "project_name", "product_name"]) {
    if (typeof updates[key] === "string") updates[key] = canonicalText(updates[key] as string, key);
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

  // 종료일 정책: 게시 전 종료(ended_at < posted_at)는 구조적으로 불가 — 저장 차단.
  // 이 상태가 되면 banner-reach-sync가 게시 이후 모든 날짜를 '종료 이후'로 버려 지표가
  // 영구 공백이 된다(2026-09-03 실측 9건). 두 필드 중 하나만 수정해도 결합 결과로 판정한다.
  if ("ended_at" in updates || "posted_at" in updates) {
    const { data: cur } = await supabase
      .from("sponsored_posts").select("posted_at, ended_at").eq("id", id).single();
    const row = (cur ?? {}) as { posted_at?: string | null; ended_at?: string | null };
    const posted = "posted_at" in updates ? updates.posted_at : row.posted_at;
    const ended = "ended_at" in updates ? updates.ended_at : row.ended_at;
    const policyError = endedAtPolicyError(posted, ended);
    if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
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
