// 크봉(크런치봉봉) 제품명 판정 — 하나라도 들어 있으면 크봉(2026-11-25 사용자 지시 "무조건 전부 크봉").
//   공백 무시 + 영문 대소문자 무시(bb바도 크봉).
// ⚠️ 파이썬 정본 `scripts/report_message.py::KBONG_KEYS / is_kbong_product` 와 짝(테스트로 고정).
export const KBONG_KEYS = ["크봉", "BB바", "BB말", "BB초", "봉봉", "크런치봉봉"] as const;

export function isKbongProduct(p: string | null | undefined): boolean {
  const n = (p ?? "").replace(/ /g, "").trim().toUpperCase();
  return KBONG_KEYS.some((k) => n.includes(k.toUpperCase()));
}
