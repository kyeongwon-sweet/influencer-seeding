export const MIN_ENTRY_DATE = "2020-01-01";

/** Today in KST, formatted as YYYY-MM-DD. */
export function todayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Yesterday in KST, formatted as YYYY-MM-DD. Used for after-midnight performance snapshots. */
export function yesterdayKST(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Max date for manual date inputs. */
export function maxDateKST(): string {
  return todayKST();
}

/** Valid manual entry date: YYYY-MM-DD from 2020-01-01 through today in KST. */
export function isValidEntryDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && s >= MIN_ENTRY_DATE && s <= maxDateKST();
}
