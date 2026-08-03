// 잠금 필드(manual_fields) 드리프트 판정 — 순수 로직(의존성 없음, 테스트 대상).
//
// 2026-08-03 사고: `이나 (인스타)`의 `manual_fields`에 `posted_at`이 들어 있어, 시트에서 게시일을
// 고쳐도 DB에 **영영 반영되지 않았다**(DB 6/07 ↔ 실제 6/09). 그 2일 차이 때문에 수집기의 게시일
// 가드가 정상 조회수(2,181,673)를 매일 버렸고, 팀은 원인을 모른 채 수기로 메워왔다.
// 잠금 자체는 필요한 기능이라 유지하되, **무시했다는 사실은 반드시 드러나야 한다.**

export type LockedDrift = { url: string; field: string; sheet: string; db: string };

/** 잠긴 필드에서 시트값이 존재하고 DB값과 다르면 true(= 영구 드리프트). */
export function lockedFieldDrift(sheetVal: unknown, dbVal: unknown): boolean {
  const present = sheetVal !== null && sheetVal !== undefined && sheetVal !== "";
  if (!present) return false; // 시트가 비면 원래 무시하는 게 정책 — 드리프트 아님
  return String(sheetVal).trim() !== String(dbVal ?? "").trim();
}

/** Slack 알림 문구. 없으면 null(조용히 넘어감). */
export function formatLockedDrift(drift: LockedDrift[], cap = 8): string | null {
  if (drift.length === 0) return null;
  const sample = drift.slice(0, cap);
  const lines = [
    `⚠️ [시트→DB 동기화] 수동 잠금 때문에 시트값이 반영되지 않은 항목 ${drift.length}건`,
    "대시보드에서 한 번 고친 필드(manual_fields)는 시트가 덮지 않습니다. 시트를 고쳐도 DB에 닿지 않으니 확인이 필요합니다.",
    ...sample.map(d => `- ${d.field}: 시트=${d.sheet} / DB=${d.db}  ${d.url}`),
  ];
  if (drift.length > sample.length) lines.push(`- ...외 ${drift.length - sample.length}건`);
  return lines.join("\n");
}
