"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ElapsedTimer, useStableHandlers } from "./perf-utils";
import Link from "next/link";
import { useToast, ToastContainer } from "@/lib/useToast";
import { HelpModal, HelpSection, HelpItem } from "@/lib/HelpModal";
import { MIN_ENTRY_DATE, maxDateKST, isValidEntryDate } from "@/lib/dateRule";
import { companyForAccount } from "@/lib/companyMap";
import { batchFetch } from "@/lib/batchFetch";
import { type DailyStats, type Post, type CsvRow, type B2bDaily, type Filters, type EditCell, INIT_FILTERS, CHANNEL_TYPES, CATEGORIES, STICKY_COL_ORDER, PROJECT_PARSE_COLS, META_ADS_MANAGER_URL, NAVER_DATALAB_URL, PRODUCT_COLORS, CHART, isStatInDateRange, getFilteredStats, formatTimestamp, normalizeChannelType, fmtChannelType, updatePostLatestStats, getPostType, viewIncrement, pickMetric, pdOf, productLabel, effectiveReach, weekKeyOf, pearson, alignedPairs, bestLag, solveLinear, alignMulti, multipleR2, parseCsvLine } from "./lib";
import CorrelationPanel from "./components/CorrelationPanel";
import FiltersBar from "./components/FiltersBar";
import LineChart from "./components/LineChart";
import PostsTable from "./components/PostsTable";



export default function MonitoringPage() {
  const { toasts, show: toast } = useToast();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ url: "", product_name: "", project_name: "", channel_type: "", cost: "", content_summary: "" });
  const [adding, setAdding] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [filters, setFilters] = useState<Filters>(INIT_FILTERS);
  const [dateTooltip, setDateTooltip] = useState<{ date: string; x: number; y: number } | null>(null);
  const [b2bTip, setB2bTip] = useState<{ date: string; x: number; y: number } | null>(null);
  const [showOtherSeries, setShowOtherSeries] = useState(false); // 범례 '그외' 드롭다운(인스타·유튜브)
  const [smooth, setSmooth] = useState(false); // 주별 합계 보기(주차 버킷, N월 N주차)
  const [showCorr, setShowCorr] = useState(false); // 상관·시차 분석 패널
  const [chartCollapsed, setChartCollapsed] = useState(false); // 메인 그래프(차트+증감표) 접기 — 기본 펼침
  const [lsSearchData, setLsSearchData] = useState<{ date: string; ratio: number; value: number | null }[]>([]);
  const [brandMetrics, setBrandMetrics] = useState<{ measured_at: string; yt_views: number | null; yt_unique_viewers: number | null; yt_search_views: number | null; ig_profile_views: number | null }[]>([]);
  const [ytTrends, setYtTrends] = useState<{ measured_at: string; keyword: string; value: number | null }[]>([]);
  const [b2bDaily, setB2bDaily] = useState<B2bDaily[]>([]); // B2B 일자별 현황 (본부공헌이익)
  const [lastUpdate, setLastUpdate] = useState<{ at: string | null; byEmail: string | null }>({ at: null, byEmail: null }); // 진짜 마지막 적재 시각 + 출처
  // 기본은 조회수만 표시(차트 정돈) — 검색량·B2B·광고비는 범례 칩으로 켜서 봄. 그외(인스타·유튜브)는 아래 effect에서 추가 숨김.
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set(["검색량", "B2B 발주량", "전체 전환 광고비"])); // 범례 클릭으로 숨긴 시리즈
  const [productTrends, setProductTrends] = useState<{ brandKey: string; products: string[]; data: { date: string; values: Record<string, number | null> }[] }>({ brandKey: "", products: [], data: [] });
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [showHelp, setShowHelp] = useState(false);
  const [trendPost, setTrendPost] = useState<Post | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [editCell, setEditCell] = useState<EditCell | null>(null);
  const [editCategory, setEditCategory] = useState<{ postId: string; infId: string; value: string } | null>(null);
  const [editPlayCount, setEditPlayCount] = useState<{ postId: string; value: string } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const lastCheckedIdx = useRef<number | null>(null); // 체크박스 Ctrl/Shift 범위 선택 기준점
  const [deleting, setDeleting] = useState(false);
  const [showTimeoutError, setShowTimeoutError] = useState(false);
  const [updatedPlayCounts, setUpdatedPlayCounts] = useState<Map<string, number | null>>(new Map());
  const [hoverUpdatedId, setHoverUpdatedId] = useState<string | null>(null);
  const [collectedAtLabel, setCollectedAtLabel] = useState<string>("");
  const [mainAdCosts, setMainAdCosts] = useState<{ date: string; total_cost: number }[]>([]);
  const previousPlayCountsRef = useRef<Map<string, number | null>>(new Map());
  const runningJobIdRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // column widths for drag-resize
  const [stickyColWidths, setStickyColWidths] = useState<Record<string, number>>({
    "증분량": 80,
  });
  const [colWidths, setColWidths] = useState<Record<string, number>>({
    "채널분류": 92, "게시일": 104, "캡션": 200, "인플루언서": 130, "업체명": 84, "상품명": 64, "프로젝트명": 150, "비용": 120, "조회수": 100, "조회당비용": 110, "도달수": 100, "도달당비용": 110, "좋아요": 80, "댓글": 80, "트렌드": 90, "특이사항": 160, "삭제": 60,
  });
  const resizingRef = useRef<{ col: string; startX: number; startW: number; isSticky: boolean } | null>(null);

  const filteredPosts = useMemo(() => posts.filter(post => {
    const displayName = (post.account_name ?? post.influencers?.name ?? "").toLowerCase();

    // 제로비 판정: 조회수가 없거나 0
    const isZeroPost = !post.latest_stats || post.latest_stats.play_count === 0 || post.latest_stats.play_count == null;

    // 1️⃣ 모든 게시물에 적용되는 필터 (제로비도 포함)
    if (filters.name && !displayName.includes(filters.name.toLowerCase())) return false;
    if (filters.project && !(post.project_name ?? "").toLowerCase().includes(filters.project.toLowerCase())) return false;
    if (filters.caption && !(post.content_summary ?? "").toLowerCase().includes(filters.caption.toLowerCase())) return false;
    if (filters.products.length > 0 && !filters.products.includes(post.product_name ?? "")) return false;
    if (filters.type !== "all" && getPostType(post.url) !== filters.type) return false;
    if (filters.channelTypes.length > 0 && !filters.channelTypes.some(ct => (post.channel_type ?? "").replace(/\s+/g, "") === ct.replace(/\s+/g, ""))) return false;
    if (filters.companies.length > 0 && !filters.companies.includes(post.company_name?.trim() || companyForAccount(post.account_name ?? post.influencers?.name) || "")) return false;
    if (filters.pdNames.length > 0 && !filters.pdNames.includes(pdOf(post.project_name))) return false;

    // 게시일 필터 (posted_at 기준)
    if (filters.postedFrom && (!post.posted_at || post.posted_at < filters.postedFrom)) return false;
    if (filters.postedTo && (!post.posted_at || post.posted_at > filters.postedTo)) return false;

    // 📌 조회수 기간 필터(dateFrom/dateTo)는 게시물을 제외하지 않음
    // 대신 표시 데이터 범위만 필터링 (filteredStats에서 처리)

    return true;
  }), [posts, filters]);

  const productOptions = useMemo(() => Array.from(
    new Set(posts.map(p => p.product_name).filter((p): p is string => Boolean(p)))
  ).sort(), [posts]);

  const companyOptions = useMemo(() => Array.from(
    new Set(posts.map(p => p.company_name?.trim() || companyForAccount(p.account_name ?? p.influencers?.name) || "").filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "ko")), [posts]);

  // PD/디자이너 옵션 — project_name이 파싱되는 게시물만 (빈 값 제외)
  const pdOptions = useMemo(() => Array.from(
    new Set(posts.map(p => pdOf(p.project_name)).filter((v): v is string => Boolean(v)))
  ).sort((a, b) => a.localeCompare(b, "ko")), [posts]);

  const hasFilter = filters.name !== "" || filters.project !== "" || filters.caption !== "" || filters.products.length > 0 || filters.type !== "all" || filters.channelTypes.length > 0 || filters.companies.length > 0 || filters.pdNames.length > 0 || filters.dateFrom !== "" || filters.dateTo !== "" || filters.postedFrom !== "" || filters.postedTo !== "";
  const colSpan = 17;

  // 마지막 수집 시각 = 최신 측정행의 적재 시각(created_at) 중 최대값 (게시물 추가 시각 아님)
  const lastMonitoredAt = useMemo(() => posts.reduce<string | null>((latest, p) => {
    const t = p.latest_stats?.created_at ?? null;
    return t && (!latest || t > latest) ? t : latest;
  }, null), [posts]);

  const formatLastUpdate = (dateStr: string): string => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) return `${diffDays}일 전`;
    if (diffHours > 0) return `${diffHours}시간 전`;
    return "방금";
  };

  const chartData = useMemo(() => {
    // 오늘(KST)은 수집 중·미완성 → 제외. playDeltaData·델타표와 동일 정책으로 맞춰
    // 이 배열에서 파생되는 광고비/검색량 조회 범위·차트 축이 하루 어긋나지 않게 한다.
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const map = new Map<string, number>();
    for (const post of filteredPosts) {
      // ⚠️ 재발방지: getFilteredStats() 사용해서 날짜 범위 일관성 보장
      const filteredStats = getFilteredStats(post.all_stats ?? [], filters.dateFrom, filters.dateTo);
      for (const s of filteredStats) {
        if (s.measured_at >= todayKST) continue;
        const v = pickMetric(s);
        if (v != null) map.set(s.measured_at, (map.get(s.measured_at) ?? 0) + v);
      }
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
  }, [filteredPosts, filters]);

  const { totalPlayCount, totalLikes, totalComments } = useMemo(() => ({
    totalPlayCount: filteredPosts.reduce((s, p) => s + (p.latest_stats?.play_count ?? 0), 0),
    totalLikes: filteredPosts.reduce((s, p) => s + (p.latest_stats?.likes_count ?? 0), 0),
    totalComments: filteredPosts.reduce((s, p) => s + (p.latest_stats?.comments_count ?? 0), 0),
  }), [filteredPosts]);

  // 표 상단 합계 행 — 행 렌더링과 동일한 s/prev 로직으로 증분량·비용·조회수 합산.
  // 체크박스로 선택한 행이 있으면 그 선택분만 합산(선택 없으면 필터된 전체).
  const tableTotals = useMemo(() => {
    const hasDate = filters.dateFrom || filters.dateTo;
    const rows = selected.size > 0 ? filteredPosts.filter(p => selected.has(p.id)) : filteredPosts;
    let delta = 0, cost = 0, views = 0, reach = 0, likes = 0, comments = 0;
    for (const post of rows) {
      const fs = hasDate ? getFilteredStats(post.all_stats ?? [], filters.dateFrom, filters.dateTo) : (post.all_stats ?? []);
      const s = fs.length > 0 ? fs[fs.length - 1] : post.latest_stats;
      const prev = hasDate ? (fs.length > 1 ? fs[fs.length - 2] : null) : post.prev_stats;
      const inc = viewIncrement(post, s, prev); if (inc != null) delta += inc;
      cost += post.cost ?? 0;
      if (s?.play_count != null) views += s.play_count;
      const r = effectiveReach(post.reach_count, s?.play_count);
      if (r != null) reach += r;
      if (s?.likes_count != null && s.likes_count >= 0) likes += s.likes_count; // 음수(-1)=인스타 좋아요 비공개 → 제외
      if (s?.comments_count != null && s.comments_count >= 0) comments += s.comments_count;
    }
    return { delta, cost, views, reach, likes, comments, count: rows.length, selectionMode: selected.size > 0 };
  }, [filteredPosts, filters.dateFrom, filters.dateTo, selected]);

  // B2B 발주량: 상품 필터가 한 카테고리(듬뿍/쫀득)면 해당 카테고리 CVS 발주량만, 아니면 듬뿍+쫀득 합계
  const b2bCategory = useMemo<"듬뿍" | "쫀득" | "total">(() => {
    const prods = filters.products;
    if (prods.length === 0) return "total";
    const cats = new Set(prods.map(p => p.includes("쫀득") ? "쫀득" : p.includes("듬뿍") ? "듬뿍" : "기타"));
    if (cats.size === 1) { const c = [...cats][0]; if (c === "쫀득") return "쫀득"; if (c === "듬뿍") return "듬뿍"; }
    return "total";
  }, [filters.products]);
  const b2bOrderOf = (d: B2bDaily) => b2bCategory === "쫀득" ? d.jjondeuk_order : b2bCategory === "듬뿍" ? d.dumbuk_order : d.total_order;

  const dailyTotals = useMemo(() => {
    // ⚠️ 재발방지: getFilteredStats() 사용해서 필터 범위 일관성 보장
    // 전체 날짜 목록 수집 (필터 범위 내만)
    const allDatesSet = new Set<string>();
    for (const post of filteredPosts) {
      const filteredStats = getFilteredStats(post.all_stats ?? [], filters.dateFrom, filters.dateTo);
      for (const s of filteredStats) {
        allDatesSet.add(s.measured_at);
      }
    }
    const allDates = [...allDatesSet].sort();
    if (allDates.length === 0) return [];

    const totals = new Map<string, { play: number; likes: number; comments: number }>(
      allDates.map(d => [d, { play: 0, likes: 0, comments: 0 }])
    );

    for (const post of filteredPosts) {
      // ⚠️ 재발방지: getFilteredStats() 사용해서 필터 범위 일관성 보장
      const filteredStats = getFilteredStats(post.all_stats ?? [], filters.dateFrom, filters.dateTo);
      const statsMap = new Map(filteredStats.map(s => [s.measured_at, s]));

      // Forward-fill: 필터 범위 내에서만 데이터 없는 날은 이전 마지막 값 유지
      // null은 데이터 없음(기여 0)
      let lastPlay: number | null = null, lastLikes: number | null = null, lastComments: number | null = null;
      for (const date of allDates) {
        if (statsMap.has(date)) {
          const s = statsMap.get(date)!;
          // 🛡️ 누적 조회수는 감소 불가 — 수집 오류로 낮아진 값은 직전 값 유지
          lastPlay     = s.play_count != null ? Math.max(lastPlay ?? s.play_count, s.play_count) : lastPlay;
          lastLikes    = s.likes_count    ?? lastLikes;
          lastComments = s.comments_count ?? lastComments;
        }
        const e = totals.get(date)!;
        totals.set(date, {
          play:     e.play     + (lastPlay     ?? 0),
          likes:    e.likes    + (lastLikes    ?? 0),
          comments: e.comments + (lastComments ?? 0),
        });
      }
    }

    return allDates.map(date => ({ date, ...totals.get(date)! }));
    // filteredPosts는 날짜필터를 제외하므로(위 getFilteredStats가 dateFrom/dateTo를 직접 참조),
    // 날짜 범위만 바꿔도 재계산되도록 deps에 명시. (누락 시 델타 표가 그래프와 어긋남)
  }, [filteredPosts, filters.dateFrom, filters.dateTo]);

  const deltaChartData = useMemo(() => {
    return chartData.slice(1).map((d, i) => ({
      date: d.date,
      value: d.value - chartData[i].value,
    }));
  }, [chartData]);

  // 메인 그래프 조회수 선 = 일별 증분(누적 아님). 광고비·검색량·B2B 와 같은 '하루치 흐름'으로 맞춰 상관관계가 보이게 함.
  // dailyTotals(전일 forward-fill + 단조보정)에서 파생 → 일자별 증감 표의 '조회수' 값과 정확히 일치.
  // 늦게 등록된 게시물의 첫 등장 조회수도 그날 증분에 그대로 포함(전부 포함 방식).
  const playDeltaData = useMemo(() => {
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return dailyTotals.slice(1)
      .map((d, i) => ({ date: d.date, value: d.play - dailyTotals[i].play }))
      .filter(d => d.date < todayKST); // 오늘(KST)은 수집 중·미완성이라 증분이 0/왜곡 → 제외(완료된 날만 표시)
  }, [dailyTotals]);

  // 상관·시차 분석: 4개 일별 흐름(광고비·조회수증분·검색량·B2B)의 공통 날짜에서 피어슨 상관 + 최적 시차.
  const correlations = useMemo(() => {
    const play = new Map(playDeltaData.map(d => [d.date, d.value]));
    const search = new Map((lsSearchData ?? []).filter(d => d.value != null).map(d => [d.date, d.value as number]));
    const ad = new Map(mainAdCosts.map(d => [d.date, d.total_cost]));
    const b2b = new Map(
      b2bDaily.filter(d => b2bOrderOf(d) != null).map(d => [d.date, b2bOrderOf(d) as number])
    );
    // 인스타 프로필 방문 · 유튜브 검색량(키워드 합산)
    const igVisit = new Map(brandMetrics.filter(d => d.ig_profile_views != null).map(d => [d.measured_at, d.ig_profile_views as number]));
    const ytSearch = new Map<string, number>();
    for (const t of ytTrends) { if (t.value != null) ytSearch.set(t.measured_at, (ytSearch.get(t.measured_at) ?? 0) + t.value); }
    const series: Record<string, Map<string, number>> = { 광고비: ad, 검색량: search, 조회수: play, B2B: b2b, 인스타방문: igVisit, 유튜브검색: ytSearch };
    // 데이터가 2일 이상 있는 지표만 분석 대상 (인스타·유튜브는 데이터 없으면 제외)
    const names = ["광고비", "검색량", "조회수", "B2B"];
    if (igVisit.size >= 2) names.push("인스타방문");
    if (ytSearch.size >= 2) names.push("유튜브검색");
    const r = (a: string, b: string) => {
      const [xs, ys] = alignedPairs(series[a], series[b], 0);
      return { r: pearson(xs, ys), n: Math.min(xs.length, ys.length) };
    };
    const pairs: { a: string; b: string; r: number | null; n: number }[] = [];
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++)
        pairs.push({ a: names[i], b: names[j], ...r(names[i], names[j]) });
    // 유의미한(중간 이상 |r|≥0.4) 쌍만 강한 순으로 — 약한 상관은 숨겨 가독성 확보
    const strongPairs = pairs
      .filter(p => p.r != null && !Number.isNaN(p.r) && Math.abs(p.r) >= 0.4)
      .sort((a, b) => Math.abs(b.r!) - Math.abs(a.r!));

    // 다중 상관 — 여러 지표가 '조회수'·'B2B 발주량'을 함께 얼마나 설명하는지(R²)
    const buildModel = (targetKey: string, target: Map<string, number>, predNames: string[]) => {
      // 예측지표를 '대상(조회수·B2B)과 가장 강하게 동행하는(|상관| 큰)' 순으로 정렬해 노출. (정렬은 R²에 영향 없음)
      const corrAbs = (n: string) => { const [xs, ys] = alignedPairs(target, series[n], 0); return Math.abs(pearson(xs, ys) ?? 0); };
      const preds = predNames.filter(n => names.includes(n)).sort((a, b) => corrAbs(b) - corrAbs(a));
      const { Y, X } = alignMulti(target, preds.map(n => series[n]));
      return { target: targetKey, preds, r2: multipleR2(Y, X), n: Y.length };
    };
    const models = [
      buildModel("조회수", play, ["광고비", "검색량", "인스타방문", "유튜브검색"]),
      buildModel("B2B 발주량", b2b, ["광고비", "검색량", "조회수"]),
    ].filter(m => m.preds.length >= 2 && m.r2 != null);

    // 광고비 → 각 지표 선행효과(며칠 뒤 반응?)
    const lags = names.filter(n => n !== "광고비").map(b => ({ b, ...(bestLag(ad, series[b], 3) ?? { lag: 0, r: NaN }) }));
    return { pairs: strongPairs, hiddenWeak: pairs.length - strongPairs.length, models, lags };
  }, [playDeltaData, lsSearchData, mainAdCosts, b2bDaily, b2bCategory, brandMetrics, ytTrends]);

  const deltaTableData = useMemo(() => {
    if (dailyTotals.length < 2) return [];
    // 검색량 증감은 "실제 전날" 기준 — 표에서 일부 날짜(수집 누락)가 빠져도 정확하게,
    // lsSearchData(모든 날짜 보유)에서 직전일 값과 비교한다. (직전 표 행과 비교하면 누락일이 합산돼 왜곡됨)
    const lsSorted = [...(lsSearchData || [])].sort((a, b) => a.date.localeCompare(b.date));
    const lsSearchDelta = (date: string): number | null => {
      const idx = lsSorted.findIndex(s => s.date === date);
      if (idx <= 0) return null;                          // 시트에 해당일 없음(미수집) 또는 직전일 없어 증감 계산 불가
      const cur = lsSorted[idx].value, prev = lsSorted[idx - 1].value;
      if (cur == null || prev == null) return null;       // 값이 비어 증감 계산 불가 → '–'(미수집)
      return cur - prev;                                  // 실제 증감(값 같으면 0 그대로 표시)
    };
    // 오늘(아직 수집 중)은 미완성 데이터라 증감이 음수로 떠 혼란을 주므로 표에서 제외
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return dailyTotals.slice(1).map((d, i) => ({
      date:     d.date,
      play:     d.play     - dailyTotals[i].play, // 전일 대비 누적 조회수 증분(늦게 등록된 게시물 첫값도 그대로 포함)
      search:   lsSearchDelta(d.date),
      comments: d.comments - dailyTotals[i].comments,
    })).filter(d => d.date < todayKST); // 오늘(KST)은 수집 중·미완성이라 증분이 0/왜곡 → 제외(완료된 날만 표시)
  }, [dailyTotals, lsSearchData]);

  // 날짜별 채널타입(바이럴/협찬) 조회수 증분 — forward-fill 적용
  const typeBreakdownByDate = useMemo(() => {
    if (dailyTotals.length < 2) return new Map<string, Record<string, number>>();
    const dates = dailyTotals.map(d => d.date);
    // O(M×S) 인덱스 빌드: post별 date→play_count Map (forward-fill)
    const postIndex = filteredPosts.map(post => {
      const group = (() => { const ct = post.channel_type ?? '기타'; return ct.startsWith('바이럴') ? '바이럴' : ct.startsWith('협찬') ? '협찬' : '기타'; })();
      const rawMap = new Map((post.all_stats ?? []).map(s => [s.measured_at, s.play_count]));
      // 날짜 순서로 forward-fill
      const byDate = new Map<string, number>();
      let last = 0;
      for (const date of dates) {
        if (rawMap.has(date)) last = rawMap.get(date) ?? last;
        byDate.set(date, last);
      }
      return { group, byDate };
    });
    const result = new Map<string, Record<string, number>>();
    for (let di = 1; di < dates.length; di++) {
      const date = dates[di], prevDate = dates[di - 1];
      const byType: Record<string, number> = {};
      for (const { group, byDate } of postIndex) {
        const delta = (byDate.get(date) ?? 0) - (byDate.get(prevDate) ?? 0);
        byType[group] = (byType[group] ?? 0) + delta;
      }
      result.set(date, byType);
    }
    return result;
  }, [dailyTotals, filteredPosts]);

  // derive sticky left positions from current widths
  const stickyLefts = useMemo(() => {
    let left = 0;
    const result: Record<string, number> = {};
    for (const col of STICKY_COL_ORDER) {
      result[col] = left;
      left += stickyColWidths[col];
    }
    return result;
  }, [stickyColWidths]);

  const { lsStartDate, lsEndDate } = useMemo(() => ({
    lsStartDate: chartData.length >= 2 ? chartData[0].date : null,
    lsEndDate: chartData.length >= 2 ? chartData[chartData.length - 1].date : null,
  }), [chartData]);

  // 라라스윗 검색량 = 상품 검색량 시트의 브랜드 전체(B열) 컬럼으로 통일 (네이버 실시간 추정값 대신)
  useEffect(() => {
    const key = productTrends.brandKey;
    if (!key || !lsStartDate || !lsEndDate) { setLsSearchData([]); return; }
    const rows = productTrends.data
      .filter(r => r.date >= lsStartDate && r.date <= lsEndDate)
      .map(r => { const v = r.values[key]; return v == null ? null : { date: r.date, ratio: v, value: v }; })
      .filter((x): x is { date: string; ratio: number; value: number } => x !== null);
    setLsSearchData(rows);
  }, [productTrends, lsStartDate, lsEndDate]);

  // 보조 그래프 데이터(검색량·B2B·광고비 등) 로드 실패 시 1회만 알림 (토스트 도배 방지)
  const auxErrShown = useRef(false);
  const auxFail = () => {
    if (auxErrShown.current) return;
    auxErrShown.current = true;
    toast("일부 그래프 데이터를 불러오지 못했어요", "error");
  };

  // 그래프 높이를 오른쪽 '일자별 증감' 표 높이에 맞춰 자동 조정.
  // (고정 높이는 조회 기간에 따라 표 길이가 바뀌면 넘치거나 비는 문제가 있어 동적 계산)
  const chartColRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [chartVH, setChartVH] = useState(175);
  useEffect(() => {
    const col = chartColRef.current, tb = tableRef.current;
    if (!col || !tb || typeof ResizeObserver === "undefined") return;
    const recompute = () => {
      const w = col.clientWidth - 32; // px-4 좌우 패딩 제외 → SVG 실제 렌더 폭
      const h = tb.clientHeight;       // 표 높이에 맞춤
      // 렌더 높이 = w × VH / VW(560). 렌더 높이를 h로 맞추려면 VH = h × 560 / w. [120,360]로 캡.
      if (w > 20 && h > 20) setChartVH(Math.max(120, Math.min(360, Math.round((h * 560) / w))));
    };
    const ro = new ResizeObserver(recompute);
    ro.observe(col); ro.observe(tb);
    recompute();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    fetch("/api/brand-metrics")
      .then(r => r.ok ? r.json() : [])
      .then(data => setBrandMetrics(Array.isArray(data) ? data : []))
      .catch(auxFail);
    fetch("/api/youtube-trends")
      .then(r => r.ok ? r.json() : [])
      .then(data => setYtTrends(Array.isArray(data) ? data : []))
      .catch(auxFail);
    fetch("/api/b2b-revenue")
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(d => setB2bDaily(Array.isArray(d?.rows) ? d.rows : []))
      .catch(auxFail);
    fetch("/api/monitoring/last-update")
      .then(r => r.ok ? r.json() : { at: null, byEmail: null })
      .then(d => setLastUpdate({ at: d?.at ?? null, byEmail: d?.byEmail ?? null }))
      .catch(auxFail);
  }, []);

  // '그외' 시리즈(인스타 프로필 방문 / 유튜브 검색량)는 기본 노출(ON). 별도 초기 숨김 처리 없음.

  // 상품별 검색량 (Google Sheet)
  useEffect(() => {
    fetch("/api/product-search-trends")
      .then(r => r.ok ? r.json() : { products: [], data: [] })
      .then(d => setProductTrends({
        brandKey: typeof d?.brandKey === "string" ? d.brandKey : "",
        products: Array.isArray(d?.products) ? d.products : [],
        data: Array.isArray(d?.data) ? d.data : [],
      }))
      .catch(auxFail);
  }, []);

  const productColorOf = (name: string) =>
    PRODUCT_COLORS[Math.max(0, productTrends.products.indexOf(name)) % PRODUCT_COLORS.length];

  // 칩 정의: "X X" 형태는 카테고리 → "…X"로 끝나는 모든 상품 합산, 그 외는 단독
  const productChips = useMemo(() => {
    const cols = productTrends.products;
    return cols.map(col => {
      const p = col.split(" ");
      const cat = p.length === 2 && p[0] === p[1] ? p[0] : null;
      const members = cat ? cols.filter(c => productLabel(c).endsWith(cat)) : [col];
      return { id: col, label: cat ?? productLabel(col), members };
    });
  }, [productTrends.products]);

  // 상단 상품 필터에서 선택된 상품 → 검색량 시리즈(라벨 매칭). 시트에 없는 상품은 라인 없음.
  const activeProductSeries = useMemo(
    () => filters.products
      .map(p => productChips.find(c => c.label === p))
      .filter((c): c is NonNullable<typeof c> => !!c),
    [filters.products, productChips]
  );

  // LineChart props 안정화 — 호버 등 무관한 부모 리렌더에서 차트가 재계산/재렌더되지 않도록 memo화.
  // (LineChart는 memo로 감싸져 있어, 아래 참조가 안정적이면 리렌더 스톰이 차단됨)
  const chartExtraSeries = useMemo(() => [
    ...activeProductSeries.map(c => ({
      name: c.label,
      color: productColorOf(c.id),
      group: "search",   // 상품별 검색량끼리 공통 세로축(절대값 비례)
      members: c.members.map(col => ({
        label: productLabel(col),
        data: productTrends.data.map(row => ({ date: row.date, value: row.values[col] ?? null })),
      })),
    })),
    // 라라스윗 공식 인스타 프로필 방문 — brandMetrics.ig_profile_views
    ...(brandMetrics.some(d => d.ig_profile_views != null) ? [{
      name: "인스타 프로필 방문",
      color: CHART.axis,
      members: [{
        label: "인스타 프로필 방문",
        data: brandMetrics.map(d => ({ date: d.measured_at, value: d.ig_profile_views })),
      }],
    }] : []),
    // 유튜브 검색 트렌드 — 키워드별 (Google Trends gprop=youtube, 상대값 0~100)
    ...Array.from(new Set(ytTrends.map(t => t.keyword))).map((kw, i) => ({
      name: `유튜브 ${kw} 검색량`,
      color: CHART.youtube[i % 2],
      members: [{
        label: kw,
        data: ytTrends.filter(t => t.keyword === kw).map(t => ({ date: t.measured_at, value: t.value })),
      }],
    })),
    // B2B 발주량 (듬뿍바+쫀득바 CVS 발주량) — 미래 계획행 제외, 오늘까지만. 카테고리 필터 시 해당 항목만.
    ...(b2bDaily.some(d => d.total_order != null) ? [{
      name: "B2B 발주량",
      color: "#16a34a",
      members: [
        ...(b2bCategory !== "쫀득" ? [{
          label: "듬뿍바 발주량",
          data: b2bDaily
            .filter(d => d.date <= new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10))
            .map(d => ({ date: d.date, value: d.dumbuk_order })),
        }] : []),
        ...(b2bCategory !== "듬뿍" ? [{
          label: "쫀득바 발주량",
          data: b2bDaily
            .filter(d => d.date <= new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10))
            .map(d => ({ date: d.date, value: d.jjondeuk_order })),
        }] : []),
      ],
    }] : []),
  ], [activeProductSeries, productTrends, brandMetrics, ytTrends, b2bDaily, b2bCategory]);

  const chartSecondaryData = useMemo(
    () => mainAdCosts.length > 0 ? mainAdCosts.map(d => ({ date: d.date, value: d.total_cost })) : undefined,
    [mainAdCosts]
  );

  const chartPostsOnDate = useCallback((date: string) =>
    filteredPosts
      .filter(p => {
        const pd = p.posted_at?.slice(0, 10);
        return pd ? (smooth ? weekKeyOf(pd) === date : pd === date) : false;
      })
      .map(p => ({ name: p.account_name ?? p.influencers?.name ?? '-', url: p.url })),
    [filteredPosts, smooth]
  );

  useEffect(() => {
    loadPosts().finally(() => setLoading(false));
    checkAndResumeMonitoring();
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // 광고비 조회 기간(YYYY-MM-DD 문자열). chartData 배열 참조가 아닌 '값'에 의존시켜
  // effect 무한 재요청(루프) 방지 — 87K 폭주 사고의 근본 수정.
  const { adFrom, adTo } = useMemo(() => ({
    adFrom: chartData.length >= 2 ? (chartData[0].date || "").split('T')[0] : "",
    adTo: chartData.length >= 2 ? (chartData[chartData.length - 1].date || "").split('T')[0] : "",
  }), [chartData]);

  // 메인 차트용 광고비 데이터 로드 (날짜 범위가 실제로 바뀔 때만 호출)
  useEffect(() => {
    if (!adFrom || !adTo) {
      setMainAdCosts([]);
      return;
    }
    const url = new URL('/api/meta-ads', window.location.origin);
    url.searchParams.set('date_from', adFrom);
    url.searchParams.set('date_to', adTo);
    fetch(url.toString())
      .then(r => {
        if (!r.ok) throw new Error(`Meta API 오류: ${r.status} ${r.statusText}`);
        return r.json();
      })
      .then(data => setMainAdCosts(Array.isArray(data) ? data : []))
      .catch(err => {
        console.error("[광고비 로드 오류]", err.message || err);
        setMainAdCosts([]);
      });
  }, [adFrom, adTo]);

  // 범례 클릭 토글 (해당 시리즈 숨김/표시)
  const seriesHidden = (k: string) => hiddenSeries.has(k);
  const toggleSeries = (k: string) => setHiddenSeries(prev => {
    const s = new Set(prev);
    if (s.has(k)) s.delete(k); else s.add(k);
    return s;
  });


  async function loadPosts() {
    const res = await fetch("/api/sponsored-posts", { cache: "no-store" });
    if (!res.ok) {
      toast("데이터 로드에 실패했습니다", "error");
      return;
    }
    const json = await res.json();
    let newPosts = Array.isArray(json) ? json : [];

    // play_count 변화 감지 — 이전 저장된 값과 비교
    if (previousPlayCountsRef.current.size > 0) {
      const updated = new Map<string, number | null>();
      newPosts.forEach(post => {
        const prevCount = previousPlayCountsRef.current.get(post.id);
        const newCount = post.latest_stats?.play_count ?? null;
        if (prevCount !== newCount && (prevCount !== null || newCount !== null)) {
          updated.set(post.id, newCount);
        }
      });

      if (updated.size > 0) {
        setUpdatedPlayCounts(updated);
        // 수집 시각 라벨 (KST) — 툴팁에 "M/D HH:mm 수집 데이터"로 표시
        const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
        setCollectedAtLabel(
          `${k.getUTCMonth() + 1}/${k.getUTCDate()} ${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")} 수집 데이터`
        );

        // 조회수가 있는 게시물에 자동으로 도달수 입력
        for (const [postId, newCount] of updated) {
          if (newCount !== null && newCount > 0) {
            const reach_count = Math.round(newCount * 0.8);
            await fetch(`/api/sponsored-posts/${postId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reach_count }),
            }).catch(() => {});

            // 로컬 상태 업데이트
            newPosts = newPosts.map(p =>
              p.id === postId ? { ...p, reach_count } : p
            );
          }
        }
      }
      previousPlayCountsRef.current.clear();
    }

    // '오늘'(KST)은 수집 중이라 기본적으로 제외(전일자까지만 노출) — 미완성 null로 인한 증감 왜곡 방지.
    // 단, 이 게시물의 오늘 값이 '실제 수집 완료'된 경우(play_collected 또는 likes 존재)에는 당일 값을 즉시 반영.
    const todayKST = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    newPosts = newPosts.map(p => {
      const all = p.all_stats ?? [];
      const today = all.find((s: DailyStats) => s.measured_at === todayKST);
      const todayCollected = !!today && (today.play_collected === true || today.likes_count != null);
      const stats = todayCollected ? all : all.filter((s: DailyStats) => s.measured_at < todayKST);
      const latest = stats.length ? stats[stats.length - 1] : null;
      // 증분량 기준 = '달력 하루'(어제자정~오늘자정): '직전 행'이 아니라 '최신 날짜 −1일' 측정으로 비교.
      // 그 전날 측정이 없으면 null → 표에 빈칸(수집시각·건너뛴 날 노이즈 제거). 최초 측정(이전 전무)은 viewIncrement에서 전체값 표시.
      const prevDayKey = latest
        ? new Date(new Date(latest.measured_at + "T00:00:00Z").getTime() - 86400000).toISOString().slice(0, 10)
        : null;
      const prevDay = prevDayKey
        ? (stats.find((s: DailyStats) => s.measured_at === prevDayKey && s.play_count != null) ?? null)
        : null;
      return {
        ...p,
        all_stats: stats,
        latest_stats: latest,
        prev_stats: prevDay,
      };
    });

    setPosts(newPosts);
  }

  async function checkAndResumeMonitoring() {
    try {
      const res = await fetch("/api/jobs");
      if (!res.ok) return;
      const jobs: { id: string; type: string; status: string }[] = await res.json();
      const inProgress = jobs.find(j => j.type === "monitoring" && j.status === "running");
      if (!inProgress) return;
      runningJobIdRef.current = inProgress.id;
      setRunning(true);
      startPollMonitoring(Date.now());
    } catch { /* 무시 */ }
  }

  function startPollMonitoring(startTime: number) {
    pollTimerRef.current = setInterval(async () => {
      if (Date.now() - startTime >= 300_000) {
        clearInterval(pollTimerRef.current!);
        pollTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        setShowTimeoutError(true);
        return;
      }
      if (document.hidden) return; // 백그라운드 탭에선 /api/jobs 폴링 스킵(Vercel 호출 절감)
      await checkMonitoringJob();
    }, 10_000);
  }

  async function checkMonitoringJob() {
    try {
      const jobRes = await fetch("/api/jobs");
      const jobs: { id: string; status: string; error?: string }[] = await jobRes.json();
      const cur = jobs.find(j => j.id === runningJobIdRef.current);
      if (cur?.status === "done") {
        clearInterval(pollTimerRef.current!);
        pollTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        await loadPosts();
        toast("모니터링 완료! 데이터가 업데이트됐습니다.", "success");
      } else if (cur?.status === "failed") {
        clearInterval(pollTimerRef.current!);
        pollTimerRef.current = null;
        runningJobIdRef.current = null;
        setRunning(false);
        toast(`모니터링 실패: ${cur.error ?? "알 수 없는 오류"}`, "error");
      }
    } catch { /* 폴링 오류 무시 */ }
  }

  async function runMonitoring() {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setRunning(true);
    setShowTimeoutError(false);

    // 수집 전에 현재 play_count들을 저장
    previousPlayCountsRef.current = new Map(
      posts.map(p => [p.id, p.latest_stats?.play_count ?? null])
    );

    const res = await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "monitoring", payload: {} }),
    });

    if (!res.ok) {
      setRunning(false);
      toast("모니터링 실행에 실패했습니다.", "error");
      return;
    }

    const { job } = await res.json();
    runningJobIdRef.current = job.id;
    toast("모니터링이 시작됐습니다. 완료 시 자동으로 업데이트됩니다.", "info");
    startPollMonitoring(Date.now());
  }

  async function refresh() {
    setLoading(true);
    await loadPosts();
    setLoading(false);
    toast("데이터를 새로고침했습니다.", "success");
  }

  async function addPost() {
    if (!form.url) return;
    setAdding(true);
    const res = await fetch("/api/sponsored-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: form.url,
        product_name: form.product_name || null,
        project_name: form.project_name || null,
        channel_type: form.channel_type || null,
        cost: form.cost !== "" ? Number(form.cost) : null,
        content_summary: form.content_summary.trim() || null,
      }),
    });
    setAdding(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast(`추가 실패: ${(err as { error?: string }).error ?? "오류가 발생했습니다."}`, "error");
      return;
    }
    setForm({ url: "", product_name: "", project_name: "", channel_type: "", cost: "", content_summary: "" });
    setShowAdd(false);
    await loadPosts();
    toast("게시물이 추가됐습니다.", "success");
  }


  function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = (ev.target?.result as string) ?? "";
      const lines = text.replace(/\r/g, "").split("\n").filter(l => l.trim());
      if (lines.length < 2) { toast("데이터가 없습니다. 헤더 포함 2줄 이상 필요합니다.", "error"); return; }
      const rows: CsvRow[] = lines.slice(1).map(line => {
        const cols = parseCsvLine(line);
        return {
          project_name: cols[0] || null,
          product_name: cols[1] || null,
          channel_type: normalizeChannelType(cols[2]),
          url: cols[3] ?? "",
          account_name: cols[4] || null,
          posted_at: isValidEntryDate(cols[5] || "") ? cols[5] : null,
          cost: cols[6] !== undefined && cols[6] !== "" ? Number(cols[6]) : null,
          reach_count: cols[7] !== undefined && cols[7] !== "" ? Number(cols[7]) : null,
        };
      }).filter(r => r.url);
      setCsvRows(rows);
    };
    reader.readAsText(file, "utf-8");
    e.target.value = "";
  }

  function downloadTemplate() {
    const csv = "프로젝트명,상품명,채널분류,게시물URL,인플루언서명,게시일(YYYY-MM-DD),비용(원),도달수\n예시프로젝트,예시상품,인플루언서,https://www.instagram.com/p/xxxxx/,홍길동,2025-05-01,500000,12000";
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "게시물_업로드_템플릿.csv";
    a.click();
  }

  async function uploadCsvRows() {
    if (csvRows.length === 0) return;
    setUploading(true);
    const res = await fetch("/api/sponsored-posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(csvRows),
    });
    const resData = await res.json().catch(() => null);
    setUploading(false);
    if (!res.ok) { toast("업로드 실패: " + ((resData as { error?: string })?.error ?? "오류"), "error"); return; }
    const s = (resData ?? {}) as { upserted?: number; created?: number; meta_filled?: number };
    const total = csvRows.length;
    setCsvRows([]);
    setShowUpload(false);
    await loadPosts();
    const skipped = total - (s.upserted ?? 0);
    toast(`처리 ${s.upserted ?? 0}건 (신규 ${s.created ?? 0} · 기존 채움 ${s.meta_filled ?? 0}${skipped > 0 ? ` · 제외 ${skipped}` : ""})`, "success");
  }

  function handleSort(col: string) {
    setSortDir(prev => sortCol === col ? (prev === "asc" ? "desc" : "asc") : "asc");
    setSortCol(col);
  }

  const sortedPosts = useMemo(() => {
    // 정렬 기준을 행이 '표시하는 값'과 일치시킴 — 날짜 필터 시 표는 범위 내 마지막/직전 값을 보여주는데,
    // 정렬이 latest_stats(필터 무시 최신값)를 쓰면 "조회수 ▼" 순서가 표시값과 어긋난다.
    const hasDate = !!(filters.dateFrom || filters.dateTo);
    const disp = new Map<string, { s: Post["latest_stats"]; prev: Post["prev_stats"] }>();
    for (const p of filteredPosts) {
      const fs = hasDate ? getFilteredStats(p.all_stats ?? [], filters.dateFrom, filters.dateTo) : (p.all_stats ?? []);
      const s = fs.length > 0 ? fs[fs.length - 1] : p.latest_stats;
      const prev = hasDate ? (fs.length > 1 ? fs[fs.length - 2] : null) : p.prev_stats;
      disp.set(p.id, { s: (s ?? null) as Post["latest_stats"], prev: (prev ?? null) as Post["prev_stats"] });
    }
    return [...filteredPosts].sort((a, b) => {
    if (!sortCol) return 0;
    const sa = disp.get(a.id)?.s ?? null, sb = disp.get(b.id)?.s ?? null;
    let av: string | number = "", bv: string | number = "";
    switch (sortCol) {
      case "인플루언서": av = (a.account_name ?? a.influencers?.name ?? "").toLowerCase(); bv = (b.account_name ?? b.influencers?.name ?? "").toLowerCase(); break;
      case "업체명": av = (a.company_name?.trim() || companyForAccount(a.account_name ?? a.influencers?.name) || "").toLowerCase(); bv = (b.company_name?.trim() || companyForAccount(b.account_name ?? b.influencers?.name) || "").toLowerCase(); break;
      case "프로젝트명": av = (a.project_name ?? "").toLowerCase(); bv = (b.project_name ?? "").toLowerCase(); break;
      case "상품명": av = (a.product_name ?? "").toLowerCase(); bv = (b.product_name ?? "").toLowerCase(); break;
      case "증분량":
        av = viewIncrement(a, sa, disp.get(a.id)?.prev ?? null) ?? -Infinity;
        bv = viewIncrement(b, sb, disp.get(b.id)?.prev ?? null) ?? -Infinity;
        break;
      case "채널분류": av = (a.channel_type ?? "").toLowerCase(); bv = (b.channel_type ?? "").toLowerCase(); break;
      case "카테고리": av = (a.influencers?.category ?? "").toLowerCase(); bv = (b.influencers?.category ?? "").toLowerCase(); break;
      case "유형": av = getPostType(a.url); bv = getPostType(b.url); break;
      case "게시일": av = a.posted_at ?? ""; bv = b.posted_at ?? ""; break;
      case "조회수": av = sa?.play_count ?? -1; bv = sb?.play_count ?? -1; break;
      case "좋아요": av = sa?.likes_count ?? -1; bv = sb?.likes_count ?? -1; break;
      case "댓글": av = sa?.comments_count ?? -1; bv = sb?.comments_count ?? -1; break;
      case "도달수": av = effectiveReach(a.reach_count, sa?.play_count) ?? -1; bv = effectiveReach(b.reach_count, sb?.play_count) ?? -1; break;
      case "비용": av = a.cost ?? -1; bv = b.cost ?? -1; break;
      case "조회당비용":
        av = (a.cost != null && sa?.play_count != null && sa.play_count > 0) ? a.cost / sa.play_count : Infinity;
        bv = (b.cost != null && sb?.play_count != null && sb.play_count > 0) ? b.cost / sb.play_count : Infinity;
        break;
      case "도달당비용": {
        const ra = effectiveReach(a.reach_count, sa?.play_count), rb = effectiveReach(b.reach_count, sb?.play_count);
        av = (a.cost != null && ra != null && ra > 0) ? a.cost / ra : Infinity;
        bv = (b.cost != null && rb != null && rb > 0) ? b.cost / rb : Infinity;
        break;
      }
    }
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredPosts, sortCol, sortDir, filters.dateFrom, filters.dateTo]);

  const sp = (col: string) => ({
    onSort: () => handleSort(col),
    sorted: (sortCol === col ? sortDir : null) as "asc" | "desc" | null,
  });

  function downloadCSV() {
    const headers = ["업로드일", "인플루언서", "링크", "프로젝트명", "상품명", "채널분류", "유형", "증분량", "조회수", "도달수", "비용(원)", "조회당비용(원)", "도달당비용(원)"];
    const rows = sortedPosts.map(post => {
      const s = post.latest_stats;
      const play = s?.play_count ?? null;
      const reach = effectiveReach(post.reach_count, play);
      const cost = post.cost ?? null;
      const cpr = cost != null && play != null && play > 0 ? (cost / play).toFixed(2) : "";
      const cpreach = cost != null && reach != null && reach > 0 ? (cost / reach).toFixed(2) : "";
      return [
        post.posted_at ?? "",
        post.account_name ?? post.influencers?.name ?? "",
        post.url ?? "",
        post.project_name ?? "",
        post.product_name ?? "",
        post.channel_type ?? "",
        getPostType(post.url),
        (viewIncrement(post, s, post.prev_stats) ?? ""),
        play ?? "",
        reach ?? "",
        cost ?? "",
        cpr,
        cpreach,
      ];
    });
    const csv = [headers, ...rows]
      .map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `모니터링_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 증분량 합계 셀 복사 — 필터된 모든 게시물의 "계정명 \t 값(▲)" 목록.
  // 값: 영상=조회수, 배너=도달수 (정확한 값, 반올림/내림 없음).
  // '종료'(ended_at) 처리된 게시물은 복사에서 제외.
  async function copyIncrementList() {
    const hasDate = filters.dateFrom || filters.dateTo;
    const lines = sortedPosts.map(post => {
      if (post.ended_at) return null;
      const fs = hasDate ? getFilteredStats(post.all_stats ?? [], filters.dateFrom, filters.dateTo) : (post.all_stats ?? []);
      const s = fs.length > 0 ? fs[fs.length - 1] : post.latest_stats;
      const prev = hasDate ? (fs.length > 1 ? fs[fs.length - 2] : null) : post.prev_stats;
      const play = s?.play_count ?? null;
      const isBanner = (post.channel_type ?? "").includes("배너");
      const value = isBanner ? effectiveReach(post.reach_count, play) : play;
      if (value == null) return null;
      const delta = viewIncrement(post, s, prev) ?? 0;
      const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "-";
      const account = post.account_name ?? post.influencers?.name ?? "";
      return `${account}\t${value.toLocaleString()} ${arrow}`;
    }).filter((l): l is string => l !== null);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast(`${lines.length}개 항목을 복사했습니다`, "success");
    } catch {
      toast("복사에 실패했습니다", "error");
    }
  }

  async function deletePost(id: string) {
    if (!confirm("게시물을 삭제하시겠습니까?")) return;
    await fetch(`/api/sponsored-posts/${id}`, { method: "DELETE" });
    setPosts(prev => prev.filter(p => p.id !== id));
    setSelected(prev => { const s = new Set(prev); s.delete(id); return s; });
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`선택한 ${selected.size}건을 삭제하시겠습니까?`)) return;
    setDeleting(true);
    const { ok, failed } = await batchFetch([...selected], id => fetch(`/api/sponsored-posts/${id}`, { method: "DELETE" }));
    const okSet = new Set(ok);
    setPosts(prev => prev.filter(p => !okSet.has(p.id)));
    setSelected(new Set(failed));
    setDeleting(false);
    if (failed.length) toast(`${ok.length}건 삭제, ${failed.length}건 실패 — 실패분은 선택 유지됨`, "error");
    else toast(`${ok.length}건 삭제됐습니다.`, "success");
  }

  // 트래킹 종료/해제 — ended_at 설정(오늘, KST)/해제(null). 종료 시 자동 수집 제외, 기존 데이터는 보존.
  async function endPost(id: string, end: boolean) {
    if (end && !confirm("이 게시물의 트래킹을 종료하시겠습니까?\n(이후 자동 수집에서 제외, 기존 데이터는 보존)")) return;
    const ended_at = end ? new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10) : null;
    await fetch(`/api/sponsored-posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ended_at }),
    });
    setPosts(prev => prev.map(p => p.id === id ? { ...p, ended_at } : p));
    toast(end ? "종료 처리됐습니다." : "종료 해제됐습니다.", "success");
  }

  async function endSelected() {
    if (selected.size === 0) return;
    const ids = [...selected].filter(id => !posts.find(p => p.id === id)?.ended_at);
    if (ids.length === 0) { toast("이미 모두 종료된 게시물입니다.", "error"); return; }
    if (!confirm(`선택한 ${ids.length}건의 트래킹을 종료하시겠습니까?\n(이후 자동 수집에서 제외, 기존 데이터는 보존)`)) return;
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setDeleting(true);
    const { ok, failed } = await batchFetch(ids, id => fetch(`/api/sponsored-posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ended_at: today }),
    }));
    const okSet = new Set(ok);
    setPosts(prev => prev.map(p => okSet.has(p.id) ? { ...p, ended_at: today } : p));
    setSelected(new Set(failed));
    setDeleting(false);
    if (failed.length) toast(`${ok.length}건 종료, ${failed.length}건 실패 — 실패분은 선택 유지됨`, "error");
    else toast(`${ok.length}건 종료 처리됐습니다.`, "success");
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  }

  // 체크박스 클릭: Ctrl/Shift(또는 Cmd) + 클릭 시 직전 클릭~현재 사이를 전체 선택
  function handleRowCheck(idx: number, id: string, e: React.MouseEvent) {
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && lastCheckedIdx.current !== null) {
      const [a, b] = [lastCheckedIdx.current, idx].sort((x, y) => x - y);
      const rangeIds = sortedPosts.slice(a, b + 1).map(r => r.id);
      setSelected(prev => { const s = new Set(prev); rangeIds.forEach(rid => s.add(rid)); return s; });
    } else {
      toggleSelect(id);
    }
    lastCheckedIdx.current = idx;
  }

  function toggleSelectAll() {
    const ids = filteredPosts.map(p => p.id);
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(ids));
  }

  // 좋아요/댓글 수동 수정(post_daily_stats). measuredAt = 표에 보이는 측정일.
  async function patchStat(postId: string, measuredAt: string, field: "likes_count" | "comments_count", value: string) {
    if (!editCell) return;
    const num = value.trim() === "" ? null : Math.round(Number(value));
    if (num != null && Number.isNaN(num)) { toast("숫자를 입력하세요.", "error"); setEditCell(null); return; }
    const res = await fetch(`/api/sponsored-posts/${postId}/stats`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(measuredAt ? { measured_at: measuredAt, [field]: num } : { [field]: num }),
    });
    const data = await res.json().catch(() => ({} as { measured_at?: string; error?: string }));
    if (res.ok) {
      const md = data?.measured_at ?? measuredAt;
      setPosts(prev => prev.map(p => {
        if (p.id !== postId) return p;
        const all = (p.all_stats ?? []).map(st => st.measured_at === md ? { ...st, [field]: num } : st);
        const latest = p.latest_stats && p.latest_stats.measured_at === md ? { ...p.latest_stats, [field]: num } : p.latest_stats;
        return { ...p, all_stats: all, latest_stats: latest };
      }));
    } else {
      toast(data?.error ?? "저장에 실패했습니다.", "error");
    }
    setEditCell(null);
  }

  async function patchPost(postId: string, field: string, value: string) {
    // Escape 취소 후 onBlur 발화 방지: editCell이 이미 null이면 저장 안 함
    if (!editCell) return;
    if (field === "posted_at" && value && !isValidEntryDate(value)) {
      toast("게시일이 올바르지 않습니다. (2020-01-01 ~ 오늘 범위로 입력)", "error");
      return;
    }
    const isNumeric = field === "cost" || field === "reach_count";
    const payload = isNumeric
      ? { [field]: value === "" ? null : Number(value) }
      : { [field]: value || null };
    const res = await fetch(`/api/sponsored-posts/${postId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const stored = isNumeric ? (value === "" ? null : Number(value)) : (value || null);
      const now = new Date().toISOString().slice(0, 10);
      setPosts(prev => prev.map(p => p.id === postId ? {
        ...p,
        [field]: stored,
        latest_stats: updatePostLatestStats(p, now)
      } : p));
    } else {
      toast("저장에 실패했습니다.", "error");
    }
    setEditCell(null);
  }

  async function patchPlayCount(postId: string, value: string) {
    const play_count = value === "" ? null : Number(value);

    try {
      // 1️⃣ 조회수 저장
      const res = await fetch(`/api/sponsored-posts/${postId}/stats`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ play_count }),
      });

      if (!res.ok) {
        toast("조회수 저장에 실패했습니다.", "error");
        setEditPlayCount(null);
        return;
      }

      const now = new Date().toISOString().slice(0, 10);
      let reach_count = null;

      // 2️⃣ 도달수 계산 및 저장
      if (play_count !== null && play_count > 0) {
        reach_count = Math.round(play_count * 0.8);

        // reach_count 저장 (비동기로 계속 진행)
        await fetch(`/api/sponsored-posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reach_count }),
        });
      } else if (play_count === null || play_count === 0) {
        // play_count가 0이면 reach_count도 null로
        await fetch(`/api/sponsored-posts/${postId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reach_count: null }),
        });
      }

      // 3️⃣ UI 업데이트
      setPosts(prev => prev.map(p => {
        if (p.id === postId) {
          const updated = {
            ...p,
            latest_stats: updatePostLatestStats(p, now, { play_count })
          };
          // reach_count는 계산된 값으로 설정 (null도 명시적으로 설정)
          if (reach_count !== null) {
            updated.reach_count = reach_count;
          }
          return updated;
        }
        return p;
      }));

      console.log(`[도달수 저장] postId=${postId}, reach_count=${reach_count}`);
      toast("저장되었습니다.", "success");
    } catch (err) {
      console.error("[patchPlayCount 오류]", err);
      toast("저장 중 오류가 발생했습니다.", "error");
    } finally {
      setEditPlayCount(null);
    }
  }

  async function patchCategory(postId: string, infId: string, value: string) {
    const res = await fetch(`/api/influencers/${infId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category: value || null }),
    });
    if (res.ok) {
      const now = new Date().toISOString().slice(0, 10);
      setPosts(prev => prev.map(p => p.id === postId
        ? {
          ...p,
          influencers: p.influencers ? { ...p.influencers, category: value || null } : null,
          latest_stats: updatePostLatestStats(p, now)
        }
        : p));
    } else {
      toast("저장에 실패했습니다.", "error");
    }
    setEditCategory(null);
  }

  function startResize(col: string, e: React.MouseEvent, isSticky = false) {
    e.preventDefault();
    e.stopPropagation();
    const startW = isSticky ? stickyColWidths[col] : colWidths[col];
    resizingRef.current = { col, startX: e.clientX, startW, isSticky };
    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return;
      const newW = Math.max(40, resizingRef.current.startW + ev.clientX - resizingRef.current.startX);
      if (resizingRef.current.isSticky) {
        setStickyColWidths(prev => ({ ...prev, [resizingRef.current!.col]: newW }));
      } else {
        setColWidths(prev => ({ ...prev, [resizingRef.current!.col]: newW }));
      }
    }
    function onUp() {
      resizingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // 표(PostsTable)에 넘기는 핸들러들을 정체성 고정 → React.memo(PostsTable)가 실제로 동작.
  // (이게 없으면 매 렌더마다 새 함수라 memo가 무력화됨)
  const tableHandlers = useStableHandlers({
    setFilters, setEditCell, patchPost, patchStat, patchPlayCount, setEditPlayCount,
    toggleSelectAll, handleRowCheck, sp, startResize, copyIncrementList, deletePost, endPost,
    toast, setTrendPost, setHoverUpdatedId,
  });

  return (
    <div className="min-h-screen">
      {/* 날짜 채널타입 분류 툴팁 */}
      {dateTooltip && (() => {
        const breakdown = typeBreakdownByDate.get(dateTooltip.date);
        const entries = breakdown
          ? (['바이럴','협찬','기타'] as const).flatMap(t =>
              breakdown[t] !== undefined && breakdown[t] !== 0 ? [[t, breakdown[t]] as const] : []
            )
          : [];
        return (
          <div
            className="pointer-events-none fixed z-[9999] bg-white border border-a-hairline rounded-lg shadow-lg px-3 py-2 text-xs"
            style={{ right: `calc(100vw - ${dateTooltip.x}px + 8px)`, top: dateTooltip.y, transform: 'translateY(-50%)' }}
          >
            {entries.length > 0 ? entries.map(([type, val]) => (
              <div key={type} className="flex items-center gap-2">
                <span className="text-a-ink-muted">{type}:</span>
                <span className={val > 0 ? "text-red-500 font-semibold" : val < 0 ? "text-blue-600 font-semibold" : "text-gray-400"}>
                  {val > 0 ? '+' : ''}{val.toLocaleString()}회
                </span>
              </div>
            )) : (
              <span className="text-a-ink-muted">조회수 데이터 없음</span>
            )}
          </div>
        );
      })()}
      {b2bTip && (() => {
        const r = b2bDaily.find(x => x.date === b2bTip.date);
        if (!r) return null;
        const won = (v: number | null) => v == null ? "-" : `${v.toLocaleString()}원`;
        const cnt = (v: number | null) => v == null ? "-" : v.toLocaleString();
        const Row = ({ label, d, j, won: asWon = true }: { label: string; d: number | null; j: number | null; won?: boolean }) => (
          <div className="flex items-center justify-between gap-4">
            <span className="text-a-ink-muted">{label}</span>
            <span className="tabular-nums">
              <span className="text-rose-600">{asWon ? won(d) : cnt(d)}</span>
              <span className="text-gray-300 mx-1">/</span>
              <span className="text-emerald-700">{asWon ? won(j) : cnt(j)}</span>
            </span>
          </div>
        );
        return (
          <div
            className="pointer-events-none fixed z-[9999] bg-white border border-a-hairline rounded-lg shadow-lg px-3 py-2.5 text-xs min-w-[230px]"
            style={{ right: `calc(100vw - ${b2bTip.x}px + 8px)`, top: b2bTip.y, transform: 'translateY(-50%)' }}
          >
            <div className="flex items-center justify-between gap-4 pb-1.5 mb-1.5 border-b border-a-hairline text-[11px] font-semibold">
              <span>{b2bTip.date.slice(5).replace("-", "/")}</span>
              <span><span className="text-rose-600">듬뿍바</span> <span className="text-gray-300">/</span> <span className="text-emerald-700">쫀득바</span></span>
            </div>
            <div className="space-y-0.5">
              <Row label="발주량" d={r.dumbuk_order} j={r.jjondeuk_order} won={false} />
              <Row label="이익" d={r.dumbuk_profit} j={r.jjondeuk_profit} />
              <Row label="전환 손익" d={r.dumbuk_conv_pl} j={r.jjondeuk_conv_pl} />
              <Row label="인지 광고비" d={r.dumbuk_ad_cost} j={r.jjondeuk_ad_cost} />
              <Row label="본부공헌이익" d={r.dumbuk_contribution} j={r.jjondeuk_contribution} />
            </div>
            <div className="flex items-center justify-between gap-4 pt-1.5 mt-1.5 border-t border-a-hairline font-semibold">
              <span className="text-a-ink">최종 이익</span>
              <span className={`tabular-nums ${(r.total_contribution ?? 0) < 0 ? "text-[#c0392b]" : "text-a-ink"}`}>{won(r.total_contribution)}</span>
            </div>
          </div>
        );
      })()}
      <header className="bg-white border-b border-gray-100 h-11 px-6 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-a-ink transition text-sm">←</Link>
          <span className="text-a-ink text-sm font-semibold tracking-tight">협찬 모니터링</span>
          <span className="text-gray-400 text-xs">
            {hasFilter ? `${filteredPosts.length} / ${posts.length}건` : `${posts.length}건`}
          </span>
        </div>
      </header>

      <div className="sticky top-14 z-[35] bg-white border-b border-a-hairline px-6 h-11 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => setShowHelp(true)}
            className="flex items-center gap-1.5 text-xs text-a-ink-muted hover:text-a-ink transition">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M10 9.5v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="10" cy="6.5" r="1" fill="currentColor"/>
            </svg>
            사용 안내
          </button>
          {(lastUpdate.at ?? lastMonitoredAt) && (
            <span className="text-xs text-a-ink-muted whitespace-nowrap">
              마지막 업데이트 <span className="font-medium text-a-ink">{formatTimestamp(lastUpdate.at ?? lastMonitoredAt!)}</span>
              <span className="ml-1.5">
                {lastUpdate.byEmail
                  ? <span className="text-a-ink-muted">· {lastUpdate.byEmail.split("@")[0]}</span>
                  : <span className="text-emerald-600">· 자동 실행</span>}
              </span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {selected.size > 0 && (
            <button onClick={endSelected} disabled={deleting}
              className="text-xs px-3 py-1.5 rounded-full border border-gray-300 text-a-ink-muted hover:bg-gray-50 disabled:opacity-40 transition">
              선택 종료 ({selected.size})
            </button>
          )}
          {selected.size > 0 && (
            <button onClick={deleteSelected} disabled={deleting}
              className="text-xs px-3 py-1.5 rounded-full border border-red-300 text-red-500 hover:bg-red-50 disabled:opacity-40 transition">
              선택 삭제 ({selected.size})
            </button>
          )}
          <button onClick={() => setShowUpload(true)} className="btn-secondary">CSV 업로드</button>
          <button onClick={() => setShowAdd(true)} className="btn-secondary">+ 게시물 추가</button>
          <button onClick={downloadCSV} disabled={filteredPosts.length === 0} className="btn-secondary">엑셀 다운로드</button>
          <button onClick={refresh} disabled={loading} className="btn-secondary">새로고침</button>
          {running && (
            <>
              <ElapsedTimer />
              <button onClick={checkMonitoringJob} className="btn-secondary">지금 확인</button>
            </>
          )}
          <button onClick={runMonitoring} disabled={running} className="btn-primary">
            {running ? (
              <span className="flex items-center gap-1.5">
                <svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                실행 중
              </span>
            ) : "지금 수집"}
          </button>
        </div>
      </div>

      <div className="p-6">

        {/* 필터 바 */}
        <FiltersBar filters={filters} setFilters={setFilters} pdOptions={pdOptions} productOptions={productOptions} companyOptions={companyOptions} hasFilter={hasFilter} />

        {filteredPosts.length > 0 && (
          <div className="relative bg-white rounded-[20px] shadow-[0_2px_16px_rgba(100,120,180,0.08)] mb-4 overflow-hidden">
            {/* 요약 수치 */}
            <div className="flex items-stretch border-b border-a-hairline">
              {(() => {
                // 라라스윗 검색량 총합 = 조회 기간 동안의 일자별 절대검색량(사이트 보정값) 합계
                // (차트 점선 '검색량'과 동일 기준. chartData는 조회수라 검색량과 무관 → lsSearchData 사용)
                const searchTotalSum = (lsSearchData ?? []).reduce((acc, d) => acc + (d.value ?? 0), 0);
                // B2B 발주량 월 누계 — 오늘까지 실데이터만(미래 계획행 제외), 카테고리 필터 반영
                const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
                const b2bTotal = b2bDaily
                  .filter(d => d.date <= today)
                  .reduce((acc, d) => acc + (b2bOrderOf(d) ?? 0), 0);
                // 전주 대비: 최근 7일 합 vs 직전 7일 합 (일별 흐름값 기준)
                const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
                const cutLast = addDays(today, -6), cutPrior = addDays(today, -13);
                const wow = (daily: { date: string; v: number }[]) => {
                  let last = 0, prior = 0;
                  for (const x of daily) {
                    if (x.date >= cutLast && x.date <= today) last += x.v;
                    else if (x.date >= cutPrior && x.date < cutLast) prior += x.v;
                  }
                  return prior === 0 ? null : (last - prior) / Math.abs(prior) * 100;
                };
                const playInc = dailyTotals.map((d, i) => ({ date: d.date, v: i > 0 ? d.play - dailyTotals[i - 1].play : 0 }));
                // B2B 발주량 듬뿍바/쫀득바 분해 합 (호버 툴팁용) — 오늘까지 실데이터만
                const pastB2b = b2bDaily.filter(d => d.date <= today);
                const dumbukSum = pastB2b.reduce((a, d) => a + (d.dumbuk_order ?? 0), 0);
                const jjondeukSum = pastB2b.reduce((a, d) => a + (d.jjondeuk_order ?? 0), 0);
                const b2bTooltip: React.ReactNode = (
                  <div className="space-y-0.5">
                    {b2bCategory !== "쫀득" && <div className="flex justify-between gap-5"><span className="text-a-ink-muted">듬뿍바 발주량</span><span className="tabular-nums text-a-ink font-semibold">{dumbukSum.toLocaleString()}</span></div>}
                    {b2bCategory !== "듬뿍" && <div className="flex justify-between gap-5"><span className="text-a-ink-muted">쫀득바 발주량</span><span className="tabular-nums text-a-ink font-semibold">{jjondeukSum.toLocaleString()}</span></div>}
                  </div>
                );
                return [
                  { label: "조회수 합계", value: totalPlayCount, color: "text-a-ink", suffix: "", delta: wow(playInc), tooltip: (
                    <div className="text-a-ink-muted leading-relaxed">바이럴(배너) 소재는 조회수 대신 <span className="font-semibold text-a-ink">도달수</span>가 합산됩니다.</div>
                  ) as React.ReactNode },
                  { label: "라라스윗 검색량 총합", value: searchTotalSum, color: "text-gray-600", suffix: "", delta: wow((lsSearchData ?? []).map(d => ({ date: d.date, v: d.value ?? 0 }))), tooltip: null as React.ReactNode },
                  { label: "B2B 발주량", value: b2bTotal, color: "text-green-600", suffix: "", delta: wow(b2bDaily.map(d => ({ date: d.date, v: b2bOrderOf(d) ?? 0 }))), tooltip: b2bTooltip },
                ];
              })().map((item, i) => (
                <div key={i} className={`flex-1 px-6 py-5 relative group/kpi ${i > 0 ? "border-l border-a-hairline" : ""} ${item.tooltip ? "cursor-help" : ""}`}>
                  <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest mb-1.5">{item.label}</p>
                  <p className={`text-[28px] font-bold tabular-nums tracking-tight leading-none ${item.color}`}>{item.value.toLocaleString()}{item.suffix}</p>
                  {item.delta != null && (
                    <p className={`mt-1 text-[11px] font-medium tabular-nums ${item.delta > 0 ? "text-red-500" : item.delta < 0 ? "text-blue-600" : "text-gray-400"}`}>
                      {item.delta > 0 ? "▲" : item.delta < 0 ? "▼" : ""} {item.delta > 0 ? "+" : ""}{item.delta.toFixed(1)}% <span className="text-gray-400 font-normal">전주 대비</span>
                    </p>
                  )}
                  {item.tooltip && (
                    <div className="hidden group-hover/kpi:block absolute left-6 top-[58px] z-30 bg-white border border-a-hairline rounded-lg shadow-lg px-3 py-2 text-xs whitespace-nowrap">
                      {item.tooltip}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {/* 차트 + 테이블 */}
            <div className={`flex divide-x divide-a-hairline ${chartCollapsed ? "hidden" : ""}`}>
              {/* 차트 */}
              <div ref={chartColRef} className="flex-1 min-w-0 self-start px-5 pt-3 pb-4">
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-semibold text-a-ink tracking-tight">조회수 트렌드 ({smooth ? "주별 합계" : "일별 증분"})</p>
                    <button type="button" onClick={() => setSmooth(v => !v)}
                      className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${smooth ? "bg-a-blue/10 border-a-blue/40 text-a-blue" : "border-a-hairline text-a-ink-muted hover:text-a-ink"}`}
                      title="주 단위(N월 N주차)로 묶어 합계로 표시">주별 합계</button>
                    <button type="button" onClick={() => setShowCorr(v => !v)}
                      className={`text-[11px] px-1.5 py-0.5 rounded border transition-colors ${showCorr ? "bg-a-blue/10 border-a-blue/40 text-a-blue" : "border-a-hairline text-a-ink-muted hover:text-a-ink"}`}
                      title="4개 지표의 상관계수와 광고비 선행효과(시차) 분석">상관분석</button>
                  </div>
                  <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap justify-end">
                    {/* 1. 조회수 */}
                    <button type="button" onClick={() => toggleSeries("조회수")}
                      className={`flex items-center gap-1.5 transition-opacity ${seriesHidden("조회수") ? "opacity-30" : ""}`}>
                      <div className="w-3 h-1 rounded-sm bg-a-blue" />
                      <span className="text-xs font-semibold text-a-ink">조회수</span>
                    </button>
                    {/* 2. 검색량 */}
                    {lsSearchData && lsSearchData.length > 0 && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => toggleSeries("검색량")}
                          className={`flex items-center gap-1.5 transition-opacity ${seriesHidden("검색량") ? "opacity-30" : ""}`}>
                          <svg width="12" height="4" viewBox="0 0 20 4"><line x1="0" y1="2" x2="20" y2="2" stroke="#f59e0b" strokeWidth="3" strokeDasharray="5 3" strokeLinecap="round" /></svg>
                          <span className="text-xs font-semibold text-a-ink">검색량</span>
                        </button>
                        <a href={NAVER_DATALAB_URL} target="_blank" rel="noreferrer"
                          className="text-[11px] text-a-ink-muted hover:text-a-ink">↗</a>
                      </div>
                    )}
                    {/* 3. B2B 발주량 */}
                    {b2bDaily.some(d => d.total_order != null) && (
                      <button type="button" onClick={() => toggleSeries("B2B 발주량")}
                        className={`flex items-center gap-1.5 transition-opacity ${seriesHidden("B2B 발주량") ? "opacity-30" : ""}`}>
                        <div className="w-3 h-1 rounded-sm" style={{ backgroundColor: "#16a34a" }} />
                        <span className="text-xs font-semibold text-a-ink">B2B 발주량</span>
                      </button>
                    )}
                    {/* 4. 전체 전환 광고비 */}
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => toggleSeries("전체 전환 광고비")}
                        className={`flex items-center gap-1.5 transition-opacity ${seriesHidden("전체 전환 광고비") ? "opacity-30" : ""}`}>
                        <div className="w-2 h-0.5 bg-gray-400" />
                        <span className="text-xs text-a-ink-muted">전체 전환 광고비</span>
                      </button>
                      <a href={META_ADS_MANAGER_URL} target="_blank" rel="noreferrer"
                        className="text-[11px] text-a-ink-muted hover:text-a-ink">↗</a>
                    </div>
                    {/* 5. 상품별 검색량 (상품 필터 선택 시) */}
                    {activeProductSeries.map(c => (
                      <button type="button" key={c.id} onClick={() => toggleSeries(c.label)}
                        className={`flex items-center gap-1.5 transition-opacity ${seriesHidden(c.label) ? "opacity-30" : ""}`}>
                        <div className="w-2 h-0.5" style={{ backgroundColor: productColorOf(c.id) }} />
                        <span className="text-xs text-a-ink-muted">{c.label}</span>
                      </button>
                    ))}
                    {/* 6. 그외 (클릭 시 인스타 프로필 방문 / 유튜브 검색량 토글) */}
                    {(brandMetrics.some(d => d.ig_profile_views != null) || ytTrends.length > 0) && (
                      <div className="relative">
                        <button type="button" onClick={() => setShowOtherSeries(v => !v)}
                          className="flex items-center gap-1 text-xs text-a-ink-muted hover:text-a-ink">
                          그 외 <span className="text-[11px] leading-none">▼</span>
                        </button>
                        {showOtherSeries && (
                          <>
                            <div className="fixed inset-0 z-20" onClick={() => setShowOtherSeries(false)} />
                            <div className="absolute right-0 top-full mt-1.5 z-30 bg-white border border-a-hairline rounded-lg shadow-lg p-2.5 space-y-2 w-max">
                              {brandMetrics.some(d => d.ig_profile_views != null) && (
                                <button type="button" onClick={() => toggleSeries("인스타 프로필 방문")}
                                  className={`flex items-center gap-1.5 w-full transition-opacity ${seriesHidden("인스타 프로필 방문") ? "opacity-30" : ""}`}>
                                  <div className="w-2 h-0.5 flex-shrink-0" style={{ backgroundColor: CHART.axis }} />
                                  <span className="text-xs text-a-ink-muted whitespace-nowrap">인스타 프로필 방문</span>
                                </button>
                              )}
                              {Array.from(new Set(ytTrends.map(t => t.keyword))).map((kw, i) => (
                                <button type="button" key={`yt-${kw}`} onClick={() => toggleSeries(`유튜브 ${kw} 검색량`)}
                                  className={`flex items-center gap-1.5 w-full transition-opacity ${seriesHidden(`유튜브 ${kw} 검색량`) ? "opacity-30" : ""}`}>
                                  <div className="w-2 h-0.5 flex-shrink-0" style={{ backgroundColor: CHART.youtube[i % 2] }} />
                                  <span className="text-xs text-a-ink-muted whitespace-nowrap">유튜브 {kw} 검색량</span>
                                </button>
                              ))}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <LineChart
                  data={playDeltaData.length >= 2 ? playDeltaData : chartData}
                  height={chartVH}
                  gradId="summaryGrad"
                  smooth={smooth}
                  hidePrimary={seriesHidden("조회수")}
                  hiddenLines={hiddenSeries}
                  lsData={lsSearchData}
                  extraSeries={chartExtraSeries}
                  secondaryData={chartSecondaryData}
                  secondaryColor={CHART.secondary}
                  postsOnDate={chartPostsOnDate}
                />
              </div>
              {/* 증감 테이블 — 내용폭에 맞춰 고정(여백 최소화), 그래프가 나머지 차지 */}
              <div ref={tableRef} className="flex-none w-max flex flex-col self-start">
                <div className="px-5 py-4 border-b border-a-hairline">
                  <p className="text-[11px] font-medium text-a-ink-muted">일자별 증감</p>
                </div>
                {deltaTableData.some(d => d.play < 0) && (
                  <div className="mx-3 mt-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-[8px] text-[11px] text-amber-700 flex items-start gap-1.5">
                    <span>⚠️</span>
                    <span>
                      누적 조회수가 감소한 날짜가 있습니다 ({deltaTableData.filter(d => d.play < 0).map(d => d.date.slice(5).replace("-", "/")).join(", ")}) — 데이터 오류를 확인하세요.
                    </span>
                  </div>
                )}
                {deltaTableData.length === 0 ? (
                  <div className="flex items-center justify-center flex-1 text-sm text-a-ink-muted py-10">측정 데이터 2일 이상 필요</div>
                ) : (
                  (() => {
                    const KR_HOLIDAYS = new Set([
                      '2025-01-01','2025-01-28','2025-01-29','2025-01-30',
                      '2025-03-01','2025-05-05','2025-05-06','2025-06-06',
                      '2025-08-15','2025-09-06','2025-09-07','2025-09-08',
                      '2025-10-03','2025-10-09','2025-12-25',
                      '2026-01-01','2026-02-17','2026-02-18','2026-02-19',
                      '2026-03-01','2026-05-05','2026-06-06','2026-08-17',
                    ]);
                    const DAY_KO = ['일','월','화','수','목','금','토'];
                    function dateColor(dateStr: string) {
                      // date-only 문자열은 UTC 자정으로 파싱됨 → getUTCDay()가 클라이언트 시간대와 무관하게 해당 날짜의 요일
                      const d = new Date(dateStr);
                      const dow = d.getUTCDay();
                      if (KR_HOLIDAYS.has(dateStr) || dow === 0) return 'text-[#8B1A2E]'; // 버건디
                      if (dow === 6) return 'text-[#1a3c82]'; // 남색
                      return 'text-a-ink';
                    }
                    const rows = [{ date: dailyTotals[0].date, play: 0, likes: 0, comments: 0 }, ...deltaTableData];
                    const reversed = [...rows].reverse();
                    const b2bMap = new Map(b2bDaily.map(d => [d.date, b2bOrderOf(d)]));
                    return (
                      <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
                        <table className="mx-auto">
                          <thead className="sticky top-0 z-10 bg-white border-b border-a-hairline">
                            <tr>
                              <th className="pl-5 pr-3 py-2.5 text-left text-[13px] font-semibold text-a-ink-muted">날짜</th>
                              <th className="px-3 py-2.5 text-right text-[13px] font-semibold text-a-ink-muted whitespace-nowrap">누적 조회수</th>
                              <th className="px-3 py-2.5 text-right text-[13px] font-semibold text-a-ink-muted">검색량</th>
                              <th className="pl-3 pr-5 py-2.5 text-right text-[13px] font-semibold text-a-ink-muted whitespace-nowrap">B2B 발주량</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reversed.map((d, i) => {
                              const dow = new Date(d.date).getUTCDay();
                              const dayLabel = DAY_KO[dow];
                              const cls = dateColor(d.date);
                              function deltaCell(v: number | null | undefined, accent = "text-red-500", negClass = "text-blue-600") {
                                if (v == null) return <td className="px-3 py-3 text-right text-gray-300">—</td>;
                                const pos = v > 0, neg = v < 0;
                                return (
                                  <td className={`px-3 py-3 text-right tabular-nums text-sm font-semibold ${pos ? accent : neg ? negClass : "text-gray-200"}`}>
                                    {pos ? "+" : ""}{v.toLocaleString()}
                                  </td>
                                );
                              }
                              return (
                                <tr key={i} className="border-b border-a-divider last:border-0 hover:bg-a-parchment/50 transition-colors">
                                  <td
                                    className={`pl-5 pr-3 py-3 text-sm font-bold tabular-nums whitespace-nowrap ${cls}`}
                                    onMouseEnter={(e) => {
                                      const r = e.currentTarget.getBoundingClientRect();
                                      setDateTooltip({ date: d.date, x: r.left, y: r.top + r.height / 2 });
                                    }}
                                    onMouseLeave={() => setDateTooltip(null)}
                                  >
                                    {d.date.slice(0,4) !== String(new Date().getFullYear()) && (
                                      <span className="text-[11px] font-normal text-gray-400 mr-0.5">'{d.date.slice(2,4)}.</span>
                                    )}
                                    {d.date.slice(5).replace("-", "/")}
                                    <span className={`ml-1.5 text-[11px] font-medium ${cls}`}>({dayLabel})</span>
                                  </td>
                                  {deltaCell(d.play, "text-red-500", "text-blue-600")}
                                  {deltaCell("search" in d ? d.search : null, "text-gray-500", "text-gray-400")}
                                  {(() => {
                                    const v = b2bMap.get(d.date);
                                    if (v == null) return <td className="pl-3 pr-5 py-3 text-right text-gray-300">-</td>;
                                    return (
                                      <td
                                        className={`pl-3 pr-5 py-3 text-right tabular-nums text-sm font-semibold cursor-help ${v < 0 ? "text-red-500" : "text-green-600"}`}
                                        onMouseEnter={(e) => {
                                          const r = e.currentTarget.getBoundingClientRect();
                                          setB2bTip({ date: d.date, x: r.left, y: r.top + r.height / 2 });
                                        }}
                                        onMouseLeave={() => setB2bTip(null)}
                                      >
                                        {v.toLocaleString()}
                                      </td>
                                    );
                                  })()}
                                </tr>
                              );
                            })}
                            {/* 여백 행 */}
                            <tr><td colSpan={4} className="py-2" /></tr>
                            <tr><td colSpan={4} className="py-2" /></tr>
                            <tr><td colSpan={4} className="py-2" /></tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>
            {showCorr && <CorrelationPanel data={correlations} />}
            {/* 그래프 접기/펼치기 — 카드 하단 (접혀도 펼쳐도 항상 하단에 노출) */}
            <button type="button" onClick={() => setChartCollapsed(v => !v)}
              className="w-full flex items-center justify-end gap-1 border-t border-a-hairline py-2 pr-6 text-xs text-a-ink-muted hover:text-a-ink hover:bg-a-parchment/40 transition-colors">
              {chartCollapsed ? "그래프 펼치기" : "그래프 접기"}
              <span className="text-[11px] leading-none">{chartCollapsed ? "▼" : "▲"}</span>
            </button>
          </div>
        )}

        {/* YouTube 검색량 차트 */}
        {(() => {
          const data = brandMetrics.map(d => ({
            measured_at: d.measured_at,
            yt_search_views: d.yt_search_views ?? 0,
          })).filter(d => d.yt_search_views > 0);
          if (data.length < 2) return null;

          const max = Math.max(...data.map(d => d.yt_search_views)) || 1;
          const VW = 900, H = 160, PAD = { t: 12, b: 28, l: 52, r: 8 };
          const iW = VW - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
          const xi = (i: number) => PAD.l + (data.length > 1 ? (i / (data.length - 1)) * iW : iW / 2);
          const yi = (v: number) => PAD.t + iH - (v / max) * iH;
          const step = Math.max(1, Math.ceil(data.length / 6));
          // 스텝 간격 라벨 + 마지막 날짜. 마지막이 직전 라벨과 겹치면 직전 제거.
          const xLabels = data.map((_, i) => i).filter(i => i % step === 0);
          const lastLabelIdx = data.length - 1;
          if (xLabels[xLabels.length - 1] !== lastLabelIdx) {
            if (lastLabelIdx - xLabels[xLabels.length - 1] < step * 0.6) xLabels.pop();
            xLabels.push(lastLabelIdx);
          }

          const points = data.map((d, i) => [xi(i), yi(d.yt_search_views)] as [number, number]);
          const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
          const areaPath = `${path} L ${points[points.length - 1][0]},${H - PAD.b} L ${PAD.l},${H - PAD.b} Z`;

          return (
            <div className="bg-white rounded-[20px] shadow-[0_2px_16px_rgba(100,120,180,0.08)] mb-4 overflow-hidden">
              <div className="px-6 pt-5 pb-1 flex items-center gap-3 flex-wrap">
                <p className="text-[11px] font-semibold text-a-ink-muted uppercase tracking-widest">유튜브 검색 유입수</p>
              </div>
              <div className="px-4 pb-4">
                <svg viewBox={`0 0 ${VW} ${H}`} className="w-full" style={{ display: "block" }}>
                  {[0, 0.5, 1].map((t, i) => (
                    <line key={i} x1={PAD.l} x2={VW - PAD.r} y1={PAD.t + iH * (1 - t)} y2={PAD.t + iH * (1 - t)} stroke="#f3f4f6" strokeWidth="1" />
                  ))}
                  <defs>
                    <linearGradient id="ytSearchGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FF0000" stopOpacity="0.08" />
                      <stop offset="100%" stopColor="#FF0000" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path d={areaPath} fill="url(#ytSearchGrad)" />
                  <path d={path} fill="none" stroke="#FF0000" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
                  {xLabels.map(i => (
                    <text key={i} x={xi(i)} y={H - 8} textAnchor="middle" fontSize="8.5" fill={CHART.axis}>
                      {data[i].measured_at.slice(5).replace("-", "/")}
                    </text>
                  ))}
                </svg>
              </div>
            </div>
          );
        })()}

          <PostsTable loading={loading} posts={posts} filteredPosts={filteredPosts} sortedPosts={sortedPosts} tableTotals={tableTotals} filters={filters} hasFilter={hasFilter} editCell={editCell} editPlayCount={editPlayCount} selected={selected} colWidths={colWidths} stickyColWidths={stickyColWidths} stickyLefts={stickyLefts} colSpan={colSpan} updatedPlayCounts={updatedPlayCounts} hoverUpdatedId={hoverUpdatedId} collectedAtLabel={collectedAtLabel} {...tableHandlers} />
      </div>

      {showHelp && (
        <HelpModal title="협찬 모니터링 사용 안내" onClose={() => setShowHelp(false)}>
          <HelpSection title="이 탭에서 하는 일">
            <p className="text-a-ink-muted leading-relaxed">협찬 게시물의 조회수·좋아요·댓글과 비용 효율(조회당·도달당비용)을 날짜별로 자동 추적하고, 검색량·전환 광고비·B2B 발주량과 함께 비교합니다.</p>
          </HelpSection>
          <HelpSection title="버튼 설명">
            <HelpItem label="+ 게시물 추가 —">협찬 게시물 URL과 프로젝트명·상품명을 입력해 추적 대상으로 등록합니다.</HelpItem>
            <HelpItem label="CSV 업로드 —">여러 게시물을 CSV로 한 번에 등록합니다. 템플릿을 내려받아 채운 뒤 올리세요.</HelpItem>
            <HelpItem label="지금 수집 —">등록된 모든 게시물의 현재 수치를 즉시 수집합니다. GitHub Actions 자동 수집과 별개로 수동으로도 실행 가능합니다.</HelpItem>
            <HelpItem label="엑셀 다운로드 —">현재 필터가 적용된 게시물 목록을 CSV로 내려받습니다.</HelpItem>
            <HelpItem label="새로고침 —">화면 데이터를 DB에서 다시 불러옵니다.</HelpItem>
          </HelpSection>
          <HelpSection title="메인 그래프">
            <HelpItem label="범례 시리즈 —">조회수 외에 검색량·전체 전환 광고비·B2B 발주량 선이 있습니다. 검색량·광고비·B2B는 기본적으로 선이 꺼져 있지만, 그래프에 마우스를 올리면 툴팁에는 항상 값이 표시됩니다. 범례를 클릭해 각 선을 켜고 끌 수 있습니다.</HelpItem>
            <HelpItem label="주별 합계 —">조회수 트렌드를 주 단위(N월 N주차) 합계로 봅니다. 기본은 일별 증분입니다.</HelpItem>
            <HelpItem label="상관분석 —">조회수·검색량·전환 광고비·B2B 발주량의 상관관계와 광고비 선행 효과(시차)를 분석합니다.</HelpItem>
          </HelpSection>
          <HelpSection title="표시 지표 정의">
            <HelpItem label="조회수 (재생수) —">videoPlayCount. 인스타그램 공개 조회수로 같은 사람이 여러 번 봐도 모두 카운트됩니다.</HelpItem>
            <HelpItem label="좋아요 / 댓글 —">likesCount / commentsCount. 게시물의 좋아요·댓글 수입니다.</HelpItem>
            <HelpItem label="조회당비용 —">비용 ÷ 조회수(재생수)</HelpItem>
            <HelpItem label="도달당비용 —">비용 ÷ 도달수. 도달수는 수동 입력값이 없으면 조회수의 80%로 추정합니다.</HelpItem>
            <HelpItem label="배너(바이럴) 소재 —">채널분류가 배너인 소재는 조회수·조회당비용 대신 도달수·도달당비용으로 성과를 집계합니다.</HelpItem>
          </HelpSection>
          <HelpSection title="표 편집">
            <HelpItem label="업체명 —">협찬 업체명입니다. 계정명 기반으로 자동 매핑되며, 셀을 클릭해 직접 수정할 수 있습니다.</HelpItem>
            <HelpItem label="종료 —">게시물을 자동 수집 대상에서 제외합니다(기존 데이터는 보존). 삭제 추정 게시물엔 '종료' 배지가 표시됩니다.</HelpItem>
          </HelpSection>
          <HelpSection title="자동 수집">
            <p className="text-a-ink-muted leading-relaxed">GitHub Actions에 의해 매일 자동으로 수치를 수집합니다. 별도 실행 없이도 일별 데이터가 쌓입니다.</p>
          </HelpSection>
        </HelpModal>
      )}

      {/* 게시물 추가 모달 */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[70]" role="dialog" aria-modal="true" aria-labelledby="modal-add-title">
          <div className="bg-white rounded-[22px] p-6 w-96 shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <div className="flex items-start justify-between mb-4">
              <h2 id="modal-add-title" className="font-semibold tracking-tight">게시물 추가</h2>
              <button
                onClick={() => { setShowAdd(false); setForm({ url: "", product_name: "", project_name: "", channel_type: "", cost: "", content_summary: "" }); }}
                aria-label="닫기"
                className="-mr-1.5 -mt-1.5 p-1.5 rounded-lg text-a-ink-muted hover:text-a-ink hover:bg-a-parchment transition">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="space-y-3">
              <input placeholder="프로젝트명" value={form.project_name}
                onChange={e => setForm(p => ({ ...p, project_name: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
              <input placeholder="상품명" value={form.product_name}
                onChange={e => setForm(p => ({ ...p, product_name: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
              <div className="relative">
                <select value={form.channel_type}
                  onChange={e => setForm(p => ({ ...p, channel_type: e.target.value }))}
                  className={`w-full appearance-none bg-white border border-a-hairline rounded-[10px] pl-3.5 pr-9 py-2.5 text-sm ${form.channel_type ? "text-a-ink" : "text-a-ink-muted"} focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition`}>
                  <option value="">채널 분류 선택</option>
                  {CHANNEL_TYPES.map(t => <option key={t} value={t}>{fmtChannelType(t)}</option>)}
                </select>
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-a-ink-muted">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                </span>
              </div>
              <input placeholder="게시물 URL (필수)" value={form.url}
                onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-[#8B1A2E] focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
              <input placeholder="비용 (원, 선택)" type="number" value={form.cost}
                onChange={e => setForm(p => ({ ...p, cost: e.target.value }))}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition" />
              <textarea placeholder="캡션 (비워두면 수집 시 자동으로 가져옵니다)" value={form.content_summary}
                onChange={e => setForm(p => ({ ...p, content_summary: e.target.value }))}
                rows={2}
                className="w-full border border-a-hairline rounded-[10px] px-3.5 py-2.5 text-sm placeholder:text-a-ink-muted focus:outline-none focus:border-a-blue focus:ring-1 focus:ring-a-blue transition resize-none" />
              <p className="text-xs text-a-ink-muted">인플루언서 계정명과 게시일은 수집 실행 시 자동으로 가져옵니다.</p>
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => { setShowAdd(false); setForm({ url: "", product_name: "", project_name: "", channel_type: "", cost: "", content_summary: "" }); }}
                className="btn-ghost">취소</button>
              <button onClick={addPost} disabled={adding || !form.url} className="btn-primary px-5 py-2 text-sm">
                {adding ? "추가 중..." : "추가"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpload && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[70]">
          <div className="bg-white rounded-[22px] p-6 w-[820px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]">
            <h2 className="font-semibold tracking-tight mb-1">CSV 일괄 업로드</h2>
            <p className="text-xs text-a-ink-muted mb-4">컬럼 순서: 프로젝트명, 상품명, 채널분류, 게시물URL, 인플루언서명, 게시일, 비용, 도달수 (5~8번째 컬럼 생략 가능)</p>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={downloadTemplate}
                className="text-xs px-3.5 py-1.5 rounded-full border border-a-hairline text-a-ink-muted hover:bg-a-parchment transition">
                템플릿 다운로드
              </button>
              <label className="text-xs px-3.5 py-1.5 rounded-full border border-a-blue text-a-blue bg-blue-50 hover:bg-blue-100 transition cursor-pointer">
                파일 선택
                <input type="file" accept=".csv" className="hidden" onChange={handleCsvFile} />
              </label>
            </div>
            {csvRows.length > 0 && (
              <div className="border border-a-hairline rounded-[10px] overflow-hidden mb-4">
                <div className="px-3 py-2 bg-a-parchment/60 text-xs text-a-ink-muted border-b border-a-hairline">
                  {csvRows.length}개 행 인식됨
                </div>
                <div className="max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-a-hairline text-a-ink-muted">
                        <th className="px-3 py-1.5 text-left font-medium">프로젝트명</th>
                        <th className="px-3 py-1.5 text-left font-medium">상품명</th>
                        <th className="px-3 py-1.5 text-left font-medium">채널분류</th>
                        <th className="px-3 py-1.5 text-left font-medium">URL</th>
                        <th className="px-3 py-1.5 text-left font-medium">인플루언서명</th>
                        <th className="px-3 py-1.5 text-left font-medium">게시일</th>
                        <th className="px-3 py-1.5 text-right font-medium">비용</th>
                        <th className="px-3 py-1.5 text-right font-medium">도달수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map((r, i) => (
                        <tr key={i} className="border-b border-a-divider last:border-0">
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.project_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.product_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.channel_type ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-blue max-w-[120px] truncate">{r.url}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.account_name ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted">{r.posted_at ?? "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted text-right">{r.cost != null ? r.cost.toLocaleString() : "-"}</td>
                          <td className="px-3 py-1.5 text-a-ink-muted text-right">{r.reach_count != null ? r.reach_count.toLocaleString() : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowUpload(false); setCsvRows([]); }} className="btn-ghost">취소</button>
              <button onClick={uploadCsvRows} disabled={uploading || csvRows.length === 0} className="btn-primary px-5 py-2 text-sm">
                {uploading ? "업로드 중..." : `${csvRows.length}개 등록`}
              </button>
            </div>
          </div>
        </div>
      )}

      {trendPost && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-[70]"
          onClick={() => setTrendPost(null)}>
          <div className="bg-white rounded-[22px] p-6 w-[680px] shadow-[0_8px_40px_rgba(0,0,0,0.12)]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-semibold tracking-tight">
                  {trendPost.account_name ?? trendPost.influencers?.name ?? "-"}
                </h2>
                <p className="text-xs text-a-ink-muted mt-0.5">
                  {[trendPost.project_name, trendPost.product_name].filter(Boolean).join(" · ")}
                </p>
              </div>
              <button onClick={() => setTrendPost(null)}
                className="text-a-ink-muted hover:text-a-ink text-xl leading-none transition">×</button>
            </div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-medium text-a-ink-muted uppercase tracking-widest">
                조회수 트렌드
              </p>
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-0.5 bg-a-blue" />
                  <span className="text-a-ink-muted">조회수</span>
                </div>
                {trendLoading && <span className="text-gray-300">로딩 중...</span>}
              </div>
            </div>
            <LineChart
              data={(trendPost.all_stats ?? [])
                .filter(s => s.play_count != null)
                .map(s => ({ date: s.measured_at, value: s.play_count! }))}
              height={220}
              gradId="modalGrad"
            />
          </div>
        </div>
      )}

      {showTimeoutError && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => setShowTimeoutError(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl w-[420px] p-7">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-[11px] font-semibold text-red-500 tracking-[0.1em] uppercase mb-1">시간 초과</p>
                <h2 className="font-bold text-[18px] text-a-ink tracking-tight">모니터링 지연 안내</h2>
              </div>
              <button onClick={() => setShowTimeoutError(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.10] transition-colors text-a-ink">
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                  <path d="M1 1l9 9M10 1L1 10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>
            <p className="text-sm text-a-ink-muted leading-relaxed mb-5">
              5분 내에 모니터링이 완료되지 않았습니다. 작업은 백그라운드에서 계속 실행 중입니다. 완료 후 새로고침 버튼을 눌러주세요.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowTimeoutError(false)}
                className="text-xs px-4 py-2 rounded-full border border-a-hairline text-a-ink hover:bg-a-parchment transition">닫기</button>
              <button onClick={() => { setShowTimeoutError(false); refresh(); }}
                className="text-xs px-4 py-2 rounded-full bg-a-blue text-white hover:bg-a-blue-hover transition">새로고침</button>
            </div>
          </div>
        </div>
      )}
      <ToastContainer toasts={toasts} />
    </div>
  );
}
