export type SheetValue = string | number | null | undefined;

export type BannerReachCell = {
  rowNumber: number;
  url: string;
  channelType: string;
  postedAt: string | null;
  measuredAt: string;
  reachCount: number;
};

export type BannerReachExtraction = {
  rows: BannerReachCell[];
  sheetRows: number;
  dateColumns: number;
  bannerRows: number;
  nonBannerRows: number;
  futurePostRowsSkipped: number;
  futureDateCellsSkipped: number;
  prePostedCellsSkipped: number;
  blankCellsSkipped: number;
  zeroCellsSkipped: number;
};

export type BannerReachExtractOptions = {
  today: string;
  statsFirstCol?: number;
  statsStartYear?: number;
};

const DEFAULT_STATS_FIRST_COL = 9; // Apps Script CONFIG.STATS_FIRST_COL: I
const DEFAULT_STATS_START_YEAR = 2026;
const ALLOWED_SHEET_POST_URL_RE = /^https:\/\/([a-z0-9-]+\.)*(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|threads\.com|threads\.net|x\.com|twitter\.com|t\.co|kakao\.com|naver\.com)\//i;

export function normalizeSheetHeader(value: SheetValue): string {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

function googleSerialDateToYmd(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function formatYmd(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2099) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseSheetDate(value: SheetValue): string | null {
  if (typeof value === "number") return googleSerialDateToYmd(value);
  const s = String(value ?? "").trim();
  if (!s) return null;

  let m = s.match(/^\s*(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) {
    return formatYmd(Number(m[1]), Number(m[2]), Number(m[3]));
  }

  m = s.match(/^\s*(\d{2})\D+(\d{1,2})\D+(\d{1,2})/);
  if (m) {
    return formatYmd(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
  }

  m = s.match(/^\s*(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const year = new Date().getFullYear();
  return formatYmd(year, Number(m[1]), Number(m[2]));
}

export function parseMonthDay(value: SheetValue): { month: number; day: number } | null {
  const ymd = parseSheetDate(value);
  if (ymd) {
    const month = Number(ymd.slice(5, 7));
    const day = Number(ymd.slice(8, 10));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day };
  }

  const m = String(value ?? "").match(/(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { month, day };
}

export function toSheetNumber(value: SheetValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(/[,\s₩원]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function extractBannerReachRows(
  values: SheetValue[][],
  options: BannerReachExtractOptions,
): BannerReachExtraction {
  const statsFirstCol = options.statsFirstCol ?? DEFAULT_STATS_FIRST_COL;
  const statsStartYear = options.statsStartYear ?? DEFAULT_STATS_START_YEAR;
  const header = values[0] ?? [];

  const urlCol = header.findIndex((h) => normalizeSheetHeader(h) === "게시물url");
  const channelTypeCol = header.findIndex((h) => normalizeSheetHeader(h) === "채널분류");
  const postedAtCol = header.findIndex((h) => normalizeSheetHeader(h) === "업로드일");
  if (urlCol === -1) throw new Error("'게시물URL' header not found");
  if (channelTypeCol === -1) throw new Error("'채널 분류'/'채널분류' header not found");

  const dateCols: Array<{ col: number; date: string }> = [];
  let year = statsStartYear;
  let prevMonth: number | null = null;
  for (let c = statsFirstCol - 1; c < header.length; c++) {
    const md = parseMonthDay(header[c]);
    if (!md) continue;
    if (prevMonth !== null && md.month < prevMonth) year += 1;
    prevMonth = md.month;
    dateCols.push({
      col: c,
      date: `${year}-${String(md.month).padStart(2, "0")}-${String(md.day).padStart(2, "0")}`,
    });
  }

  const out: BannerReachExtraction = {
    rows: [],
    sheetRows: Math.max(0, values.length - 1),
    dateColumns: dateCols.length,
    bannerRows: 0,
    nonBannerRows: 0,
    futurePostRowsSkipped: 0,
    futureDateCellsSkipped: 0,
    prePostedCellsSkipped: 0,
    blankCellsSkipped: 0,
    zeroCellsSkipped: 0,
  };

  for (let i = 1; i < values.length; i += 1) {
    const row = values[i] ?? [];
    const rawUrl = String(row[urlCol] ?? "").trim();
    if (!rawUrl || !ALLOWED_SHEET_POST_URL_RE.test(rawUrl)) continue;

    const channelType = String(row[channelTypeCol] ?? "");
    if (!channelType.includes("배너")) {
      out.nonBannerRows += 1;
      continue;
    }
    out.bannerRows += 1;

    const postedAt = postedAtCol === -1 ? null : parseSheetDate(row[postedAtCol]);
    if (postedAt && postedAt > options.today) {
      out.futurePostRowsSkipped += 1;
      continue;
    }

    for (const dc of dateCols) {
      const n = toSheetNumber(row[dc.col]);
      if (n === null) {
        out.blankCellsSkipped += 1;
        continue;
      }
      if (dc.date > options.today) {
        out.futureDateCellsSkipped += 1;
        continue;
      }
      if (postedAt && dc.date < postedAt) {
        out.prePostedCellsSkipped += 1;
        continue;
      }
      if (n === 0) {
        out.zeroCellsSkipped += 1;
        continue;
      }
      out.rows.push({
        rowNumber: i + 1,
        url: rawUrl,
        channelType,
        postedAt,
        measuredAt: dc.date,
        reachCount: n,
      });
    }
  }

  return out;
}
