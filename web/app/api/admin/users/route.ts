import { NextRequest, NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { getAdminEmail } from "@/lib/admin-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 관리자 전용: 대시보드 사용자 목록 조회.
export async function GET() {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const client = await clerkClient();
  const { data } = await client.users.getUserList({ limit: 200 });
  const base = data
    .map(u => ({
      id: u.id,
      email:
        u.emailAddresses.find(e => e.id === u.primaryEmailAddressId)?.emailAddress ??
        u.emailAddresses[0]?.emailAddress ??
        "",
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || null,
      banned: u.banned,
      createdAt: u.createdAt,
      lastSignInAt: u.lastSignInAt,
    }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  // 최근 활동(접속 기기/브라우저/지역 + 활동 시각) — 사용자별 최신 세션의 latestActivity.
  // (관리자만 보는 페이지·저빈도라 사용자당 1콜 병렬 허용)
  const users = await Promise.all(
    base.map(async u => {
      try {
        const { data: sessions } = await client.sessions.getSessionList({ userId: u.id, limit: 10 });
        const latest = sessions.slice().sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
        const act = latest?.latestActivity;
        return {
          ...u,
          activity: latest
            ? {
                at: latest.lastActiveAt,
                browser: act?.browserName ?? null,
                device: act?.deviceType ?? (act?.isMobile ? "Mobile" : null),
                city: act?.city ?? null,
                country: act?.country ?? null,
                ip: act?.ipAddress ?? null,
              }
            : null,
        };
      } catch {
        return { ...u, activity: null };
      }
    })
  );

  return NextResponse.json({ users });
}

// 관리자 전용: 사용자 초대(추가). @lalasweet.kr 이메일만 허용.
export async function POST(req: NextRequest) {
  if (!(await getAdminEmail())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  if (!email || !email.endsWith("@lalasweet.kr")) {
    return NextResponse.json({ error: "@lalasweet.kr 이메일만 초대할 수 있습니다." }, { status: 400 });
  }

  const client = await clerkClient();
  try {
    await client.invitations.createInvitation({ emailAddress: email, ignoreExisting: true });
  } catch (err: unknown) {
    const msg =
      (err as { errors?: { message?: string }[] })?.errors?.[0]?.message ??
      (err as Error)?.message ??
      "초대에 실패했습니다.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
