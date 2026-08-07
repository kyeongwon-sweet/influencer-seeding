/**
 * 비광고성 소재 판정 — 파이썬 감사 스크립트(`scripts/audit_invalid_creator_fields.py`)와 **같은 규칙**.
 *
 * 왜 공유 규칙인가: 한쪽만 고치면 "감사는 정상이라는데 대시보드는 이상"처럼 갈라진다.
 * 이 저장소는 이미 경로별 판정 드리프트로 사고를 겪었다(`ig-post-urls.ts` 주석 참고).
 *
 * 비광고성 미러링(외부 영상 미러링 등)은 특정 상품을 홍보하는 게 아니라서
 *  · 소재명에 담당자·상품을 적지 않고
 *  · 상품명은 "-"로 둔다 (2026-08-07 사용자 지시)
 */

/** 비광고성 소재의 상품명 고정값. DB 실측상 기존 46건이 이미 이 값을 쓰고 있다. */
export const NON_AD_PRODUCT_NAME = "-";

/** 소재명 앞에 붙는 장식/드래그핸들 문자(⠿ 등)를 벗긴다. '['는 규칙 시작 문자라 벗기지 않는다. */
export function stripDecorativePrefix(text: string): string {
  const s = String(text ?? "").trim();
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "[") break;
    // 유니코드 기호·구두점·공백·제어/포맷이면 장식으로 보고 벗긴다(문자·숫자는 실제 내용).
    if (/[\p{S}\p{P}\p{Z}\p{C}]/u.test(ch)) { i += 1; continue; }
    break;
  }
  return s.slice(i);
}

const NON_AD_PREFIXES = ["비광고성"];

/** 비광고성 미러링 소재인가. asset_name(없으면 project_name)을 넘긴다. */
export function isNonAdAsset(assetName?: string | null): boolean {
  const s = stripDecorativePrefix(String(assetName ?? ""));
  return NON_AD_PREFIXES.some((p) => s.startsWith(p));
}
