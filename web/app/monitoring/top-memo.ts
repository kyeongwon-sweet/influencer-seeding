// 요일별·업체별 성과 패널 호버 메모박스의 순수 로직(렌더는 components/TopPostsMemo.tsx).
// JSX가 없어야 node --test 의 타입 스트립으로 단위 테스트할 수 있어 파일을 분리했다.

export type TopPost = {
  account: string;         // 계정명(없으면 인플루언서명)
  asset: string;           // 소재명(없으면 빈 문자열)
  value: number;           // 영상=조회수 · 배너=도달수
  unitCost: number | null; // 게시물 단가 CPV/CPR = 비용÷value (비용 없으면 null)
};

export type TopMemo = {
  items: TopPost[];        // value 내림차순 상위
  more: number;            // 목록에 못 들어간 나머지 개수
  best: TopPost | null;    // 최저 단가(가장 효율적) — 조회수 상위와 다를 수 있어 따로 보여준다
};

export const MEMO_TOP_N = 5;
export const EMPTY_MEMO: TopMemo = { items: [], more: 0, best: null };

// 소재명 토큰 경계. 공통 접두사를 토큰 중간에서 자르면 말이 깨져 오히려 못 읽는다.
const ASSET_SEPARATORS = new Set(["_", ".", "-", " ", "]", ")", "/", "|"]);
// 이보다 짧은 공통 부분은 걷어낼 가치가 없다(우연히 겹친 한두 글자까지 자르면 이름이 훼손된다).
const MIN_COMMON_PREFIX = 8;

/**
 * 같은 메모 안 소재명들의 공통 접두사를 걷어낸다.
 *
 * 라이브 실측: 소재명이 `[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_초딩유행템_var12.렉카_…`
 * 처럼 캠페인 공통 보일러플레이트로 시작해서, 폭이 좁은 메모박스에서 5줄이 전부
 * `[26.08]F_V_JD멜…`로 잘려 서로 구분이 안 됐다(같은 계정의 다른 소재도 구별 불가).
 * 명명 규칙을 하드코딩하지 않고 **표시할 항목들 사이의 공통 부분**만 데이터로 걷어낸다.
 */
export function stripCommonAssetPrefix(assets: string[]): string[] {
  const filled = assets.filter((a) => a.length > 0);
  if (filled.length < 2) return assets;      // 비교 대상이 없으면 그대로

  let common = filled[0];
  for (const asset of filled.slice(1)) {
    let i = 0;
    while (i < common.length && i < asset.length && common[i] === asset[i]) i += 1;
    common = common.slice(0, i);
    if (common.length < MIN_COMMON_PREFIX) return assets;
  }

  let cut = -1;
  for (let i = common.length - 1; i >= 0; i -= 1) {
    if (ASSET_SEPARATORS.has(common[i])) { cut = i + 1; break; }
  }
  if (cut < MIN_COMMON_PREFIX) return assets;

  const prefix = common.slice(0, cut);
  return assets.map((a) => (a.startsWith(prefix) ? a.slice(cut) : a));
}

/** 버킷(요일·업체)에 속한 게시물들을 메모박스용 상위 목록으로 압축. 값 없는 게시물은 호출부에서 제외. */
export function buildTopMemo(rows: TopPost[], n: number = MEMO_TOP_N): TopMemo {
  if (!rows.length) return EMPTY_MEMO;
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const priced = rows.filter((r): r is TopPost & { unitCost: number } => r.unitCost != null);
  // 단가는 낮을수록 효율적 → 최소값. 동률이면 먼저 나온 것 유지.
  const best = priced.length ? priced.reduce((a, b) => (b.unitCost < a.unitCost ? b : a)) : null;

  const items = sorted.slice(0, n);
  const assets = stripCommonAssetPrefix(items.map((it) => it.asset));
  return {
    items: items.map((it, i) => (assets[i] === it.asset ? it : { ...it, asset: assets[i] })),
    more: Math.max(0, sorted.length - n),
    best,
  };
}
