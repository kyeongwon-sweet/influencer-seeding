export const NAVER_AGE_BANDS = [
  { code: "1", label: "~12세" },
  { code: "2", label: "13-18세" },
  { code: "3", label: "19-24세" },
  { code: "4", label: "25-29세" },
  { code: "5", label: "30-34세" },
  { code: "6", label: "35-39세" },
  { code: "7", label: "40-44세" },
  { code: "8", label: "45-49세" },
  { code: "9", label: "50-54세" },
  { code: "10", label: "55-59세" },
  { code: "11", label: "60세 이상" },
] as const;

export type AgeDistributionRow = { code: string; label: string; relativeTotal: number; share: number };
export type AgeDistribution = {
  source: "Naver DataLab";
  groupId: string;
  label: string;
  start: string;
  end: string;
  granularity: "일별" | "월별";
  collectedAt: string;
  rows: AgeDistributionRow[];
  note: string;
  warning: string | null;
};

type BuildInput = {
  groupId: string;
  label: string;
  start: string;
  end: string;
  granularity: "일별" | "월별";
  total: number;
  ageTotals: number[];
  collectedAt: string;
};

const finiteNonNegative = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const cleanText = (value: unknown, limit: number) => typeof value === "string" ? value.replace(/[<>]/g, "").slice(0, limit) : "";
const validDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function sumNaverRatios(raw: unknown): number {
  if (!raw || typeof raw !== "object") throw new Error("연령 응답 형식이 올바르지 않습니다.");
  const results = (raw as { results?: unknown }).results;
  const first = Array.isArray(results) ? results[0] : null;
  const data = first && typeof first === "object" ? (first as { data?: unknown }).data : null;
  if (!Array.isArray(data)) throw new Error("연령 응답에 시계열이 없습니다.");
  let total = 0;
  for (const item of data) {
    if (!item || typeof item !== "object") throw new Error("연령 응답 시계열이 올바르지 않습니다.");
    const period = (item as { period?: unknown }).period;
    const ratio = (item as { ratio?: unknown }).ratio;
    if (!validDate(period) || !finiteNonNegative(ratio) || (ratio as number) > 100) throw new Error("연령 응답 값이 올바르지 않습니다.");
    total += ratio as number;
  }
  return total;
}

export function buildAgeDistribution(input: BuildInput): AgeDistribution {
  if (!validDate(input.start) || !validDate(input.end) || input.start > input.end) throw new Error("연령 분포 기간이 올바르지 않습니다.");
  if (!finiteNonNegative(input.total) || input.ageTotals.length !== NAVER_AGE_BANDS.length || input.ageTotals.some(value => !finiteNonNegative(value))) throw new Error("연령 분포 값이 올바르지 않습니다.");
  const knownTotal = input.ageTotals.reduce((sum, value) => sum + value, 0);
  const canMeasureUnknown = input.total + 1e-9 >= knownTotal;
  const unknown = canMeasureUnknown ? Math.max(0, input.total - knownTotal) : null;
  const denominator = unknown === null ? knownTotal : input.total;
  if (denominator <= 0) throw new Error("선택한 상품과 기간에 연령 데이터가 없습니다.");
  const values: { code: string; label: string; relativeTotal: number }[] = input.ageTotals.map((relativeTotal, index) => ({ ...NAVER_AGE_BANDS[index], relativeTotal }));
  if (unknown !== null) values.push({ code: "unknown", label: "나이 미상", relativeTotal: unknown });
  let accumulated = 0;
  const rows = values.map((row, index) => {
    const share = index === values.length - 1 ? Math.max(0, 1 - accumulated) : row.relativeTotal / denominator;
    accumulated += share;
    return { ...row, share };
  });
  return {
    source: "Naver DataLab",
    groupId: cleanText(input.groupId, 40),
    label: cleanText(input.label, 80),
    start: input.start,
    end: input.end,
    granularity: input.granularity,
    collectedAt: cleanText(input.collectedAt, 60),
    rows,
    note: "Google Trends에는 연령 데이터가 없어 네이버 DataLab 연령 필터를 별도로 조회한 참고 분포입니다. Google 검색 사용자 분포로 해석하지 마세요.",
    warning: unknown === null ? "연령별 상대값 합이 전체 상대값보다 커 나이 미상은 계산하지 않았습니다. 표시 비율은 확인된 11개 연령대 안에서 정규화했습니다." : null,
  };
}

export function validateAgeDistribution(raw: unknown): AgeDistribution {
  if (!raw || typeof raw !== "object") throw new Error("저장된 연령 분포가 올바르지 않습니다.");
  const value = raw as Partial<AgeDistribution>;
  if (value.source !== "Naver DataLab" || !validDate(value.start) || !validDate(value.end) || value.start! > value.end! || !["일별", "월별"].includes(value.granularity || "") || !Array.isArray(value.rows)) throw new Error("저장된 연령 분포가 올바르지 않습니다.");
  const allowed = new Map<string, string>([...NAVER_AGE_BANDS.map(row => [row.code, row.label] as [string, string]), ["unknown", "나이 미상"]]);
  const seen = new Set<string>();
  const rows = value.rows.map(row => {
    if (!row || !allowed.has(row.code) || allowed.get(row.code) !== row.label || seen.has(row.code) || !finiteNonNegative(row.relativeTotal) || !finiteNonNegative(row.share) || row.share > 1) throw new Error("저장된 연령 분포 값이 올바르지 않습니다.");
    seen.add(row.code);
    return { code: row.code, label: row.label, relativeTotal: row.relativeTotal, share: row.share };
  });
  if (rows.length < 11 || Math.abs(rows.reduce((sum, row) => sum + row.share, 0) - 1) > 1e-6) throw new Error("저장된 연령 분포 합계가 올바르지 않습니다.");
  return { source: "Naver DataLab", groupId: cleanText(value.groupId, 40), label: cleanText(value.label, 80), start: value.start!, end: value.end!, granularity: value.granularity as "일별" | "월별", collectedAt: cleanText(value.collectedAt, 60), rows, note: cleanText(value.note, 500), warning: value.warning === null ? null : cleanText(value.warning, 500) };
}
