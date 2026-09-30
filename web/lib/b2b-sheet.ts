type SheetCell = string | number | null | undefined;

export type B2bDayValues = {
  order: number | null;
  profit: number | null;
  ad: number | null;
  contrib: number | null;
};

export type B2bDailyRecord = {
  date: string;
  dumbuk_order: number | null;
  dumbuk_profit: number | null;
  dumbuk_conv_pl: number | null;
  dumbuk_ad_cost: number | null;
  dumbuk_contribution: number | null;
  jjondeuk_order: number | null;
  jjondeuk_profit: number | null;
  jjondeuk_conv_pl: number | null;
  jjondeuk_ad_cost: number | null;
  jjondeuk_contribution: number | null;
  total_order: number | null;
  total_contribution: number | null;
  updated_at: string;
};

function toNum(value: SheetCell): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  const normalized = String(value).replace(/[,\s₩]/g, "").replace(/^\((.+)\)$/, "-$1").trim();
  if (!normalized || normalized === "-" || normalized.startsWith("#")) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function sumPresent(...values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => value != null);
  return present.length === 0 ? null : present.reduce((sum, value) => sum + value, 0);
}

function validDate(year: number, month: number, day: number): string | null {
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() !== month - 1
    || candidate.getUTCDate() !== day
  ) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseB2bDate(cell: SheetCell, nowKST = new Date(Date.now() + 9 * 3_600_000)): string | null {
  if (typeof cell === "number" && Number.isFinite(cell) && cell >= 30_000 && cell <= 80_000) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.round(cell) * 86_400_000);
    return validDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  if (typeof cell !== "string") return null;
  // Google Sheets API의 한국어 날짜 표시(예: "5. 1 (금)")에서 요일과 끝 마침표만 제거한다.
  // 주차 라벨("26.04. W4")은 그대로 남아 아래의 엄격한 날짜 정규식에서 거부된다.
  const value = cell.trim().replace(/\s*\([^)]*\)\s*$/, "").replace(/\.\s*$/, "").trim();

  const ymd = value.match(/^(\d{2}|\d{4})\s*[.\/-]\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\D.*)?$/);
  if (ymd) {
    const rawYear = Number(ymd[1]);
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return validDate(year, Number(ymd[2]), Number(ymd[3]));
  }

  const mdy = value.match(/^(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\s*[.\/-]\s*(\d{4}))?$/);
  if (!mdy) return null;
  const month = Number(mdy[1]);
  const day = Number(mdy[2]);
  const currentYear = nowKST.getUTCFullYear();
  const currentMonth = nowKST.getUTCMonth() + 1;
  const year = mdy[3]
    ? Number(mdy[3])
    : month - currentMonth > 6
      ? currentYear - 1
      : currentMonth - month > 6
        ? currentYear + 1
        : currentYear;
  return validDate(year, month, day);
}

function findCell(row: SheetCell[], predicate: (value: string) => boolean): number {
  return row.findIndex((cell) => typeof cell === "string" && predicate(cell.trim()));
}

function detectDateColumn(rows: SheetCell[][], headerIndex: number, orderColumn: number, nowKST: Date): number {
  const candidates = Array.from({ length: Math.max(0, orderColumn) }, (_, index) => index);
  let best = -1;
  let bestScore = 0;
  for (const column of candidates) {
    let score = 0;
    for (let row = headerIndex + 1; row < Math.min(rows.length, headerIndex + 80); row++) {
      if (parseB2bDate(rows[row]?.[column], nowKST)) score++;
    }
    if (score > bestScore) {
      best = column;
      bestScore = score;
    }
  }
  return best;
}

export function diagnoseB2bSheetRows(
  rows: SheetCell[][],
  nowKST = new Date(Date.now() + 9 * 3_600_000),
) {
  const markerIndex = rows.findIndex((row) => row.some(
    (cell) => typeof cell === "string" && cell.includes("일자별 현황"),
  ));
  let headerIndex = -1;
  let orderColumn = -1;
  for (let row = Math.max(0, markerIndex); row < rows.length; row++) {
    const cvs = findCell(rows[row], (value) => value === "CVS 발주량");
    const b2b = findCell(rows[row], (value) => value === "B2B 발주량");
    if (cvs >= 0 && b2b >= 0) {
      headerIndex = row;
      orderColumn = cvs;
      break;
    }
  }
  const dateColumn = headerIndex < 0 ? -1 : detectDateColumn(rows, headerIndex, orderColumn, nowKST);
  const dateCandidates = headerIndex < 0
    ? []
    : Array.from({ length: Math.max(0, orderColumn) }, (_, column) => ({
      column,
      samples: rows
        .slice(headerIndex + 1, headerIndex + 8)
        .map((row) => row?.[column])
        .filter((value) => value != null && value !== "")
        .map((value) => ({
          type: typeof value,
          value: String(value).slice(0, 40),
          parsed: parseB2bDate(value, nowKST),
        })),
    }));
  return { rowCount: rows.length, markerIndex, headerIndex, orderColumn, dateColumn, dateCandidates };
}

export function parseB2bSheetRows(
  rows: SheetCell[][],
  options: { nowKST?: Date; maxDate?: string } = {},
): Map<string, B2bDayValues> {
  const nowKST = options.nowKST ?? new Date(Date.now() + 9 * 3_600_000);
  const out = new Map<string, B2bDayValues>();
  const markerIndex = rows.findIndex((row) => row.some(
    (cell) => typeof cell === "string" && cell.includes("일자별 현황"),
  ));

  let headerIndex = -1;
  let cvsColumn = -1;
  let b2bColumn = -1;
  let profitColumn = -1;
  let adColumn = -1;
  let contributionColumn = -1;

  for (let row = Math.max(0, markerIndex); row < rows.length; row++) {
    const cvs = findCell(rows[row], (value) => value === "CVS 발주량");
    const b2b = findCell(rows[row], (value) => value === "B2B 발주량");
    if (cvs < 0 || b2b < 0) continue;
    headerIndex = row;
    cvsColumn = cvs;
    b2bColumn = b2b;
    profitColumn = findCell(rows[row], (value) => value.includes("이익") && value.includes("원"));
    adColumn = findCell(rows[row], (value) => value === "전체 광고비" || value === "인지 광고비");
    contributionColumn = findCell(rows[row], (value) => value.startsWith("CVS 손익"));
    break;
  }
  if (headerIndex < 0) return out;

  const dateColumn = detectDateColumn(rows, headerIndex, cvsColumn, nowKST);
  if (dateColumn < 0) return out;

  let started = false;
  let gap = 0;
  for (let row = headerIndex + 1; row < rows.length; row++) {
    const date = parseB2bDate(rows[row]?.[dateColumn], nowKST);
    if (!date) {
      if (started && ++gap > 8) break;
      continue;
    }
    gap = 0;
    started = true;
    if (options.maxDate && date > options.maxDate) continue;
    out.set(date, {
      // 행/셀 부재는 미측정(null), 시트에 명시된 숫자 0만 실제 0으로 보존한다.
      order: sumPresent(toNum(rows[row]?.[cvsColumn]), toNum(rows[row]?.[b2bColumn])),
      profit: profitColumn >= 0 ? toNum(rows[row]?.[profitColumn]) : null,
      ad: adColumn >= 0 ? toNum(rows[row]?.[adColumn]) : null,
      contrib: contributionColumn >= 0 ? toNum(rows[row]?.[contributionColumn]) : null,
    });
  }
  return out;
}

export function buildB2bDailyRecords(
  dumbuk: Map<string, B2bDayValues>,
  jjondeuk: Map<string, B2bDayValues>,
  updatedAt = new Date().toISOString(),
): B2bDailyRecord[] {
  const dates = [...new Set([...dumbuk.keys(), ...jjondeuk.keys()])].sort((a, b) => a.localeCompare(b));
  return dates.map((date) => {
    const d = dumbuk.get(date);
    const j = jjondeuk.get(date);
    return {
      date,
      dumbuk_order: d?.order ?? null,
      dumbuk_profit: d?.profit ?? null,
      dumbuk_conv_pl: null,
      dumbuk_ad_cost: d?.ad ?? null,
      dumbuk_contribution: d?.contrib ?? null,
      jjondeuk_order: j?.order ?? null,
      jjondeuk_profit: j?.profit ?? null,
      jjondeuk_conv_pl: null,
      jjondeuk_ad_cost: j?.ad ?? null,
      jjondeuk_contribution: j?.contrib ?? null,
      total_order: sumPresent(d?.order, j?.order),
      total_contribution: sumPresent(d?.contrib, j?.contrib),
      updated_at: updatedAt,
    };
  });
}

export function yesterdayKST(nowMs = Date.now()): string {
  const today = new Date(nowMs + 9 * 3_600_000).toISOString().slice(0, 10);
  return new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}
