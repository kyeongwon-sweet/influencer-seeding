export const PRODUCT_SEARCH_BRAND_KEY = "라라스윗 라라스윗";

type SheetCell = string | number | null | undefined;

function text(cell: SheetCell): string {
  return cell == null ? "" : String(cell).trim();
}

function numberValue(cell: SheetCell): number | null {
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const value = text(cell);
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSheetDate(cell: SheetCell): string | null {
  const value = text(cell);
  const match = value.match(/^(\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\D.*)?$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function buildProductSearchTrends(
  rows: SheetCell[][],
  brandKey = PRODUCT_SEARCH_BRAND_KEY,
) {
  if (rows.length < 3) return { brandKey, products: [] as string[], data: [] };

  const groupRow = rows[0] ?? [];
  const nameRow = rows[1] ?? [];
  const width = Math.max(groupRow.length, nameRow.length);
  const productCols: string[] = [];
  let currentGroup = "";

  for (let column = 1; column < width; column++) {
    const explicitGroup = text(groupRow[column]);
    if (explicitGroup) currentGroup = explicitGroup;
    const child = text(nameRow[column]);
    const name = currentGroup && child
      ? `${currentGroup} ${child}`
      : child || currentGroup;
    productCols.push(name);
  }

  const data = rows.slice(2)
    .map((row) => {
      const date = normalizeSheetDate(row[0]);
      if (!date) return null;
      const values: Record<string, number | null> = {};
      productCols.forEach((name, index) => {
        if (name) values[name] = numberValue(row[index + 1]);
      });
      return { date, values };
    })
    .filter((row): row is { date: string; values: Record<string, number | null> } => row !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    brandKey,
    products: productCols.filter((name) => name && name !== brandKey),
    data,
  };
}
