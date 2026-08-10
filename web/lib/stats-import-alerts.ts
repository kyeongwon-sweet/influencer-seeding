function rejectedUrlLabel(url: string): string {
  const account = url.match(/tiktok\.com\/(\@[^/]+)\/(?:video|photo)\//i)?.[1];
  return account ? `${account} ${url}` : url;
}

export function rejectedUrlIdentifiers(url: string): string[] {
  const identifiers = [url];
  const tiktokId = url.match(/\/(?:video|photo)\/(\d+)/i)?.[1];
  if (tiktokId) identifiers.push(`tt:${tiktokId}`);
  return identifiers;
}

export function formatRejectedInvalidUrlAlert(count: number, urls: string[]): string {
  const samples = [...new Set(urls.filter(Boolean))]
    .slice(0, 6)
    .map(rejectedUrlLabel)
    .join(", ");
  const sampleText = samples ? ` 차단 URL: ${samples}` : "";
  return `🚨 [시트 조회수 입력] 잘못된 TikTok 게시물 ID ${count}건 차단 — URL 끝 숫자를 원본 링크와 확인하세요.${sampleText}`;
}

export function buildRejectedInvalidUrlAlert(
  rejectedUrls: string[],
  endedIdentifiers: ReadonlySet<string>,
): string | null {
  const activeRejectedUrls = rejectedUrls.filter(
    url => !rejectedUrlIdentifiers(url).some(identifier => endedIdentifiers.has(identifier)),
  );
  return activeRejectedUrls.length > 0
    ? formatRejectedInvalidUrlAlert(activeRejectedUrls.length, activeRejectedUrls)
    : null;
}
