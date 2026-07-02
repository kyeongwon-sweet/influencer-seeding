import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAdminEmail } from "@/lib/admin-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 관리자 전용: 사용자 차단/차단해제. body: { banned: boolean }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const adminEmail = await getAdminEmail();
  if (!adminEmail) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const banned = Boolean(body?.banned);

  const client = await clerkClient();

  // 본인(관리자) 계정 차단 방지 — 자기 잠금 사고 예방.
  const target = await client.users.getUser(id);
  const targetEmail = (
    target.emailAddresses.find(e => e.id === target.primaryEmailAddressId)?.emailAddress ??
    target.emailAddresses[0]?.emailAddress ??
    ""
  ).toLowerCase();
  if (banned && targetEmail === adminEmail) {
    return NextResponse.json({ error: "본인 계정은 차단할 수 없습니다." }, { status: 400 });
  }

  try {
    if (banned) await client.users.banUser(id);
    else await client.users.unbanUser(id);
  } catch (err: unknown) {
    const msg =
      (err as { errors?: { message?: string }[] })?.errors?.[0]?.message ??
      (err as Error)?.message ??
      "처리에 실패했습니다.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
