import { auth, clerkClient } from "@clerk/nextjs/server";
import { isAdminEmail } from "./admin";

// 현재 로그인 사용자의 primary 이메일 조회(소문자).
export async function currentUserEmail(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await (await clerkClient()).users.getUser(userId);
  return (
    user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    ""
  ).toLowerCase();
}

// 관리자면 이메일 반환, 아니면 null. (API 라우트에서 권한 게이트로 사용)
export async function getAdminEmail(): Promise<string | null> {
  const email = await currentUserEmail();
  return isAdminEmail(email) ? email : null;
}
