const INSTAGRAM_HANDLE_RE = /^[A-Za-z0-9._]+$/;

export function isViralInstagram(url: unknown, channelType: unknown): boolean {
  return /instagram\.com/i.test(String(url ?? "")) && String(channelType ?? "").includes("바이럴");
}

/**
 * Instagram 바이럴 채널명은 표시명이 아니라 실제 핸들만 DB에 저장한다.
 * 표시명처럼 보이는 값은 null로 바꿔 신규 저장과 기존값 덮어쓰기를 모두 막는다.
 */
export function accountNameForSponsoredWrite(
  url: unknown,
  channelType: unknown,
  accountName: unknown,
): string | null {
  const clean = String(accountName ?? "").trim();
  if (!clean) return null;
  if (!isViralInstagram(url, channelType)) return clean;

  const withoutAt = clean.replace(/^@/, "");
  return INSTAGRAM_HANDLE_RE.test(withoutAt) ? withoutAt : null;
}
