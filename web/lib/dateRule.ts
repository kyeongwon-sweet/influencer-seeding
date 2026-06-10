// 수동 날짜 입력 공용 검증 규칙 — 비정상 날짜(5자리 연도·미래 등) 방지.
// 모든 수동 날짜 입력에 min={MIN_ENTRY_DATE} max={maxDateKST()} + 저장 시 isValidEntryDate() 적용.

export const MIN_ENTRY_DATE = "2020-01-01";

/** 오늘(KST) YYYY-MM-DD — date input의 max */
export function maxDateKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD 형식 + 2020-01-01 ~ 오늘(KST) 범위면 true */
export function isValidEntryDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= MIN_ENTRY_DATE && s <= maxDateKST();
}
