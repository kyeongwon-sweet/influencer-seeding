export type DedupeByIdResult<T> = {
  rows: T[];
  duplicateIds: string[];
};

/** Preserve the first row for each id so React keys and aggregate inputs stay unique. */
export function dedupeRowsById<T extends { id: string }>(rows: T[]): DedupeByIdResult<T> {
  const seen = new Set<string>();
  const duplicateIds = new Set<string>();
  const uniqueRows: T[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) {
      duplicateIds.add(row.id);
      continue;
    }
    seen.add(row.id);
    uniqueRows.push(row);
  }

  return { rows: uniqueRows, duplicateIds: [...duplicateIds] };
}
