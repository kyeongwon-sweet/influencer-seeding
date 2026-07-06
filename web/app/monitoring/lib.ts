// monitoring/page.tsx 에서 분리한 순수 유틸 — 타입·상수·데이터/통계 헬퍼.
// React/JSX 의존이 없어 단위 테스트 가능(tests/monitoring-lib.test.ts).
// JSX 컴포넌트(TH/TD/Sparkline/LineChart)는 page.tsx 에 그대로 둔다.

export type DailyStats = {
  measured_at: string;
  play_count: number | null;
  likes_count: number | null;
  comments_count: number | null;
  reach_count?: number | null; // 배너 도달수 일별 이력 — 배너 증분 계산용(조회수 대체)
  created_at?: string | null; // 적재(수집) 시각 — 마지막 업데이트 표시용
  play_collected?: boolean;   // 원본 조회수가 실제 수집됐는지 (mono 보정 전) — 당일 반영 판정용
};

export type Post = {
  id: string;
  url: string;
  posted_at: string | null;
  product_name: string | null;
  project_name: string | null;
  account_name: string | null;
  company_name: string | null;
  channel_type: string | null;
  cost: number | null;
  reach_count: number | null;
  notes: string | null;
  content_summary: string | null;
  created_at: string;
  ended_at: string | null;
  influencers: { id: string; name: string; platform: string; post_type: string | null; category?: string | null } | null;
  latest_stats: DailyStats | null;
  prev_stats: DailyStats | null;
  all_stats: DailyStats[];
};

export type CsvRow = { url: string; project_name: string | null; product_name: string | null; channel_type: string | null; account_name: string | null; posted_at: string | null; cost: number | null; reach_count: number | null };

export type B2bDaily = {
  date: string;
  dumbuk_order: number | null; dumbuk_profit: number | null; dumbuk_conv_pl: number | null; dumbuk_ad_cost: number | null; dumbuk_contribution: number | null;
  jjondeuk_order: number | null; jjondeuk_profit: number | null; jjondeuk_conv_pl: number | null; jjondeuk_ad_cost: number | null; jjondeuk_contribution: number | null;
  total_order: number | null; total_contribution: number | null;
};

export type Filters = { name: string; project: string; caption: string; products: string[]; type: string; channelTypes: string[]; companies: string[]; pdNames: string[]; dateFrom: string; dateTo: string; postedFrom: string; postedTo: string };
export const INIT_FILTERS: Filters = { name: "", project: "", caption: "", products: [], type: "all", channelTypes: [], companies: [], pdNames: [], dateFrom: "", dateTo: "", postedFrom: "", postedTo: "" };
export type EditCell = { postId: string; field: "project_name" | "product_name" | "channel_type" | "cost" | "reach_count" | "account_name" | "company_name" | "posted_at" | "notes" | "content_summary" | "likes_count" | "comments_count"; value: string; measuredAt?: string };
export const POST_TYPES = ["릴스", "피드", "숏폼", "롱폼"];
export const CHANNEL_TYPES = [
  "바이럴(배너)",
  "바이럴(영상)",
  "협찬(먹스타)",
  "협찬(인플루언서)",
  "협찬(파워채널/매거진)",
  "무상시딩 (영상)",
  "무상시딩 (피드)",
  "온드미디어",
];
export const CATEGORIES = [
  { value: "A",   desc: "찐팬서사 (꾸준함)" },
  { value: "B",   desc: "선망성" },
  { value: "C",   desc: "맛잘알" },
  { value: "D",   desc: "친근감" },
  { value: "기타", desc: "기타" },
];

/**
 * 재발방지: 필터 범위 유틸리티
 *
 * 문제: chartData, dailyTotals, 게시물 증분 등이 서로 다른 범위의 데이터 사용
 * 해결: 모든 데이터 계산이 이 함수를 통해 필터 범위를 일관되게 적용
 */
export function isStatInDateRange(stat: DailyStats, dateFrom: string, dateTo: string): boolean {
  if (dateFrom && stat.measured_at < dateFrom) return false;
  if (dateTo && stat.measured_at > dateTo) return false;
  return true;
}

export function getFilteredStats(allStats: DailyStats[], dateFrom: string, dateTo: string): DailyStats[] {
  return allStats.filter(s => isStatInDateRange(s, dateFrom, dateTo));
}

export function fmt(v: number | null | undefined) {
  return v == null ? "-" : v.toLocaleString();
}

export function formatTimestamp(ts: string): string {
  const d = new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000); // KST 고정
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function normalizeChannelType(value: string | null): string | null {
  if (!value) return null;
  // 표준 표기로 정규화: 연속/앞뒤 공백 정리 + 괄호 앞 공백 보장("바이럴(영상)"→"바이럴 (영상)").
  // 저장 시점에 적용해 시트·드롭다운·CSV 어디서 와도 표기가 통일됨(필터 매칭 누락 방지).
  return value.trim().replace(/\s+/g, " ").replace(/\s*\(/g, " (");
}

// 표시 전용: 괄호 앞에 공백 추가 ("바이럴(배너)" → "바이럴 (배너)"). 저장값은 그대로, 화면에만 적용(필터 매칭은 공백 무시).
export function fmtChannelType(ct: string | null | undefined): string {
  return (ct ?? "").replace(/\s*\(/g, " (");
}

export function updatePostLatestStats(post: Post, now: string, overrides?: Partial<DailyStats>): DailyStats | null {
  if (!post.latest_stats) {
    return {
      measured_at: now,
      play_count: overrides?.play_count ?? null,
      likes_count: overrides?.likes_count ?? null,
      comments_count: overrides?.comments_count ?? null,
    };
  }
  return {
    ...post.latest_stats,
    measured_at: now,
    play_count: overrides?.play_count ?? post.latest_stats.play_count,
    likes_count: overrides?.likes_count ?? post.latest_stats.likes_count,
    comments_count: overrides?.comments_count ?? post.latest_stats.comments_count,
  };
}

export function getPostType(url: string): string {
  if (url.includes("instagram.com")) return url.includes("/reel/") ? "릴스" : "피드";
  if (url.includes("youtube.com") || url.includes("youtu.be")) return url.includes("/shorts/") ? "숏폼" : "롱폼";
  return "-";
}

export const STICKY_COL_ORDER = ["증분량"] as const;

export function getThumbnailUrl(url: string): string | null {
  let m = url.match(/youtube\.com\/shorts\/([^/?&#]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  m = url.match(/[?&]v=([^&]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  m = url.match(/youtu\.be\/([^/?#]+)/);
  if (m) return `https://i.ytimg.com/vi/${m[1]}/mqdefault.jpg`;
  return null;
}

export function isRecentPost(postedAt: string | null): boolean {
  if (!postedAt) return false;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  return postedAt.slice(0, 10) >= yesterdayStr && postedAt.slice(0, 10) <= todayStr;
}

export function hasNotableChange(post: Post): boolean {
  const l = post.latest_stats, p = post.prev_stats;
  if (!l || !p) return false;
  return (l.play_count ?? 0) > (p.play_count ?? 0) || (l.comments_count ?? 0) > (p.comments_count ?? 0);
}

export function getCategoryLabel(val: string | null | undefined): string {
  if (!val) return "-";
  const cat = CATEGORIES.find(c => c.value === val);
  return cat ? cat.desc : val;
}

// 증분량: 직전 측정이 있으면 차이, 없고 '첫 측정'(그 이전 측정 자체가 없음)이면 그날 전체.
// 필터로 직전만 잘렸고 이전 측정이 존재하면 계산 불가(null → '-').
// 배너(바이럴(배너))는 조회수(play_count)가 없어 도달수(reach_count)를 조회수처럼 취급 → 동일 로직으로 전일 대비 증분.
export function viewIncrement(post: Post, s: DailyStats | null | undefined, prev: DailyStats | null | undefined): number | null {
  const isBanner = (post.channel_type ?? "").includes("배너");
  const val = (st: DailyStats | null | undefined) => (isBanner ? st?.reach_count : st?.play_count);
  const sv = val(s);
  if (!s || sv == null) return null;
  const pv = val(prev);
  if (pv != null) return sv - pv;
  const hasEarlier = (post.all_stats ?? []).some(x => x.measured_at < s.measured_at && val(x) != null);
  return hasEarlier ? null : sv;
}

export function pickMetric(s: DailyStats): number | null {
  // 조회수(재생수)만 사용 — 재생수가 없는 게시물을 좋아요로 대체하지 않음(지표 혼선 방지)
  return s.play_count;
}

// 소재명 규칙(파일명 생성기)으로 작성된 project_name을 17개 차원으로 파싱.
// 예: [26.06]F_V_DB혼_바이럴_상시_바이럴형_CU단독강조_var1.릴스_퀄리티근황.X_1P_황경원_260615_빙과_이수현
export const PROJECT_PARSE_COLS = [
  "제작월", "채널구분", "영상/이미지 구분", "제품코드", "광고종류", "스킴명", "대분류 포맷",
  "소분류 연출", "배리에이션 여부", "지면 유형", "상세연출(소재구분)", "프로젝트",
  "파트 구분", "마케터", "집행시작일", "본부 구분", "PD/디자이너",
] as const;

export function parseProjectName(name: string | null | undefined): Record<string, string> {
  const r: Record<string, string> = {};
  for (const c of PROJECT_PARSE_COLS) r[c] = "";
  if (!name || !name.startsWith("[")) return r;
  const parts = name.split("_");
  if (parts.length < 3) return r;
  const m = parts[0].match(/(\[.+?\])(.*)/);
  if (m) { r["제작월"] = m[1]; r["채널구분"] = m[2]; }
  if (parts.length > 1) r["영상/이미지 구분"] = parts[1];
  if (parts.length > 2) r["제품코드"] = parts[2];
  if (parts.length > 3) r["광고종류"] = parts[3];
  if (parts.length > 4) r["스킴명"] = parts[4];
  if (parts.length > 5) r["대분류 포맷"] = parts[5];
  if (parts.length > 6) r["소분류 연출"] = parts[6];
  if (parts.length > 7) { const kl = parts[7].split("."); r["배리에이션 여부"] = kl[0]; r["지면 유형"] = kl.slice(1).join("."); }
  if (parts.length > 8) { const mn = parts[8].split("."); r["상세연출(소재구분)"] = mn[0]; r["프로젝트"] = mn.slice(1).join("."); }
  if (parts.length > 9) r["파트 구분"] = parts[9];
  if (parts.length > 10) r["마케터"] = parts[10];
  if (parts.length > 11) r["집행시작일"] = parts[11];
  if (parts.length > 12) r["본부 구분"] = parts[12];
  if (parts.length > 13) {
    // PD/디자이너: 소재명이 파일명으로 오염된 경우 정리 — 확장자·사본표시 제거 후 마지막 토큰(이름)만 추출.
    // 예) "260616_빙과_김민우 (1).zip" → "김민우", "빙과_홍정민" → "홍정민", "홍정민.zip" → "홍정민"
    const tail = parts.slice(13).join("_").trim().replace(/\.(mp4|mov|png|jpe?g|gif|webp|zip|pdf)$/i, "");
    r["PD/디자이너"] = (tail.split("_").pop() ?? "").trim().replace(/\s*\(\d+\)\s*$/, "").trim();
  }
  return r;
}

// 게시물의 PD/디자이너 (파싱 불가 시 빈 문자열)
export function pdOf(projectName: string | null | undefined): string {
  return parseProjectName(projectName)["PD/디자이너"].trim();
}

export function smoothCurvePath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  if (pts.length === 2) return `M ${pts[0][0]},${pts[0][1]} L ${pts[1][0]},${pts[1][1]}`;
  const t = 0.35;
  let d = `M ${pts[0][0].toFixed(2)},${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) * t;
    const cp2x = p2[0] - (p3[0] - p1[0]) * t;
    // 세로 제어점은 구간 양 끝값 사이로 클램프 → 봉우리/골이 데이터 점 위/아래로 솟는 오버슛(상단 넘침) 방지
    const yLo = Math.min(p1[1], p2[1]), yHi = Math.max(p1[1], p2[1]);
    const cp1y = Math.max(yLo, Math.min(yHi, p1[1] + (p2[1] - p0[1]) * t));
    const cp2y = Math.max(yLo, Math.min(yHi, p2[1] - (p3[1] - p1[1]) * t));
    d += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d;
}

// "전체 전환 광고비" 클릭 시 이동할 Meta 광고 관리자 링크
export const META_ADS_MANAGER_URL = "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=363574841093560&attribution_windows=default&business_id=447480832673184&columns=name%2Cdelivery%2Crecommendations_guidance%2Cresults%2Ccost_per_result%2Cbudget%2Cspend%2Cimpressions%2Creach%2Cfrequency%2Ccpm%2Cactions%3Aomni_purchase%2Cschedule%2Cend_time%2Cattribution_setting%2Cbid%2Clast_significant_edit%2Cquality_score_organic%2Cquality_score_ectr%2Cquality_score_ecvr%2Ccampaign_name%2Cpurchase_roas%3Aomni_purchase&date=2023-05-10_2026-06-11%2Cmaximum&global_scope_id=447480832673184&insights_comparison_date=&insights_date=2023-05-10_2026-06-11%2Cmaximum&treenav=true&comparison_date=";

// "라라스윗 검색량" 클릭 시 이동할 네이버 데이터랩 링크
export const NAVER_DATALAB_URL = "https://datalab.naver.com/keyword/trendResult.naver?hashKey=N_2bd38f2b4d0d20ffd665b46aaa1f1833";

// 상품별 검색량 라인 색상 팔레트
export const PRODUCT_COLORS = ["#16a34a", "#9333ea", "#ea580c", "#0891b2", "#db2777", "#65a30d", "#7c3aed", "#0d9488", "#c2410c", "#be123c"];

// 차트 구조 색상(라인/축/격자) 중앙화 — 값은 기존과 동일(렌더 무변경), 한 곳에서 관리해 변경 누락 방지
export const CHART = {
  primary: "#3b82f6",              // 조회수 라인·면적·강조점
  axis: "#9ca3af",                 // 축 라벨, 인스타 프로필 방문선 등 회색
  grid: "#e5e7eb",                 // 격자선
  secondary: "#b3b3b3",            // 보조축(전체 전환 광고비)
  youtube: ["#d1d5db", "#cbd5e1"], // 유튜브 검색량 2색(아이스크림/라라스윗)
};
// "쫀득바 쫀득바"처럼 동일 단어가 반복된 헤더는 한 번만 표시
export function productLabel(name: string): string {
  const parts = name.split(" ");
  return parts.length === 2 && parts[0] === parts[1] ? parts[0] : name;
}

// 도달수: 수동 입력값이 있으면 그 값, 없으면 조회수의 80% 자동 추정
export function effectiveReach(reachCount: number | null | undefined, playCount: number | null | undefined): number | null {
  if (reachCount != null) return reachCount;
  if (playCount != null && playCount > 0) return Math.round(playCount * 0.8);
  return null;
}

// 변화폭이 매우 작을 때(필터로 2~3일만 남는 등) min→max를 차트 높이 전체로 늘리면
// 0.x% 변화가 거대한 기울기로 과장돼 그래프가 깨져 보임. 최소 도메인 폭(최댓값의 frac)을 확보해 완만하게.
// 정상 뷰는 변화폭이 이미 커서 영향 없음.
export function padDomain(min: number, max: number, frac = 0.06): [number, number] {
  const span = max - min;
  const minSpan = Math.abs(max) * frac;
  if (span >= minSpan || minSpan === 0) return [min, max];
  const c = (min + max) / 2, h = minSpan / 2;
  return [c - h, c + h];
}

// 7일 이동평균(trailing) — 일별 노이즈를 줄여 추세·상관을 또렷하게. null은 평균에서 제외.
export function movingAvg<T extends Record<string, unknown>>(rows: T[], field: keyof T, win = 7): T[] {
  return rows.map((r, i) => {
    const slice = rows.slice(Math.max(0, i - win + 1), i + 1)
      .map(x => x[field] as number | null).filter((v): v is number => v != null);
    if (slice.length === 0) return r;
    return { ...r, [field]: slice.reduce((a, b) => a + b, 0) / slice.length };
  });
}

// 주차 키: "YYYY-MM-DD" → "YYYY-MM-W" (W=해당 월의 주차, ceil(일/7)). 같은 주의 데이터는 같은 키.
export function weekKeyOf(date: string): string {
  const [y, m, d] = date.split("T")[0].split("-");
  return `${y}-${m}-${Math.ceil(parseInt(d, 10) / 7)}`;
}
// 주차 키 → "5월 3주차" 라벨.
export function weekLabelOf(key: string): string {
  const [, m, w] = key.split("-");
  return `${parseInt(m, 10)}월 ${w}주차`;
}
// 주단위 합계 버킷 — date를 주차 키로 묶어 지정 필드를 합산(전부 null이면 null). 입력은 날짜 오름차순 가정.
export function weeklySum<T extends Record<string, unknown>>(rows: T[], fields: (keyof T)[]): T[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const r of rows) {
    const k = weekKeyOf(r["date"] as string);
    const g = groups.get(k);
    if (g) g.push(r); else { groups.set(k, [r]); order.push(k); }
  }
  return order.map(k => {
    const grp = groups.get(k)!;
    const out = { ...grp[0], date: k } as T;
    for (const f of fields) {
      const nums = grp.map(x => x[f] as number | null).filter((v): v is number => v != null);
      (out as Record<string, unknown>)[f as string] = nums.length ? nums.reduce((a, b) => a + b, 0) : null;
    }
    return out;
  });
}

// 피어슨 상관계수 (-1~1). 표본 2개 미만이거나 분산 0이면 null.
export function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; syy += ys[i] * ys[i]; sxy += xs[i] * ys[i]; }
  const cov = n * sxy - sx * sy;
  const dx = Math.sqrt(n * sxx - sx * sx), dy = Math.sqrt(n * syy - sy * sy);
  if (dx === 0 || dy === 0) return null;
  return cov / (dx * dy);
}

// 두 일별 시리즈(date→value)를 lag(일)만큼 어긋나게 정렬해 공통 날짜의 (x,y) 쌍 반환.
// lag>0 : x가 y보다 lag일 선행(예: 광고비 → lag일 뒤 검색량).
export function alignedPairs(x: Map<string, number>, y: Map<string, number>, lag: number): [number[], number[]] {
  const xs: number[] = [], ys: number[] = [];
  for (const [d, xv] of x) {
    const yd = new Date(d + "T00:00:00Z");
    yd.setUTCDate(yd.getUTCDate() + lag);
    const yKey = yd.toISOString().slice(0, 10);
    const yv = y.get(yKey);
    if (yv != null) { xs.push(xv); ys.push(yv); }
  }
  return [xs, ys];
}

// lag -maxLag..+maxLag 중 |상관|이 가장 큰 시차와 그 계수. (선행/지연 효과 탐지)
export function bestLag(x: Map<string, number>, y: Map<string, number>, maxLag = 3): { lag: number; r: number } | null {
  let best: { lag: number; r: number } | null = null;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const [xs, ys] = alignedPairs(x, y, lag);
    const r = pearson(xs, ys);
    if (r == null) continue;
    if (!best || Math.abs(r) > Math.abs(best.r)) best = { lag, r };
  }
  return best;
}

// 선형연립방정식 Ax=b 풀이 (가우스 소거, 부분 피벗). 특이행렬이면 null.
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-9) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]); // row[i] = 대각원소 M[i][i] (소거 완료 후). 과거 row[i][i] 오타로 항상 NaN이었음
}

// 타깃 맵과 예측변수 맵들을 '모두 값이 있는 공통 날짜'로 정렬.
export function alignMulti(target: Map<string, number>, preds: Map<string, number>[]): { Y: number[]; X: number[][] } {
  const Y: number[] = [];
  const X: number[][] = preds.map(() => []);
  for (const [d, yv] of target) {
    if (!Number.isFinite(yv)) continue;
    const vals = preds.map(m => m.get(d));
    if (vals.every(v => v != null && Number.isFinite(v))) { Y.push(yv); vals.forEach((v, i) => X[i].push(v as number)); }
  }
  return { Y, X };
}

// 다중 회귀 결정계수 R² (여러 예측변수가 타깃을 함께 설명하는 정도 0~1). 표본 부족/특이면 null.
export function multipleR2(Y: number[], Xs: number[][]): number | null {
  const n = Y.length, k = Xs.length;
  if (k === 0 || n < k + 3) return null; // 예측변수 + 절편 + 최소 여유
  const p = k + 1; // 절편 포함 열 수
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const XtY = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const row = [1, ...Xs.map(c => c[i])];
    for (let a = 0; a < p; a++) { XtY[a] += row[a] * Y[i]; for (let b = 0; b < p; b++) XtX[a][b] += row[a] * row[b]; }
  }
  const beta = solveLinear(XtX, XtY);
  if (!beta) return null;
  const ybar = Y.reduce((s, v) => s + v, 0) / n;
  let ssr = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    const row = [1, ...Xs.map(c => c[i])];
    const pred = row.reduce((s, v, j) => s + v * beta[j], 0);
    ssr += (Y[i] - pred) ** 2; sst += (Y[i] - ybar) ** 2;
  }
  if (sst === 0) return null;
  const r2 = Math.max(0, Math.min(1, 1 - ssr / sst));
  return Number.isFinite(r2) ? r2 : null;
}

// CSV 한 줄 파싱 — 따옴표 안의 쉼표/이스케이프("") 처리. 각 셀은 trim.
export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (line[i] === ',' && !inQ) {
      result.push(cur.trim()); cur = "";
    } else cur += line[i];
  }
  result.push(cur.trim());
  return result;
}
