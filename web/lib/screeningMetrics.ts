// 스크리닝 지표 계산 — 정본(2026-11-20, apify-webhook/route.ts 에서 분리).
//
// ⚠️ scripts/metrics.py 는 옛 파이썬 원본이다(자동 실행 경로 없음). 공식은 여기만 고친다.
//
// 2026-11-20 계산 변경(사용자 결정 "계산을 바꾸자"):
//   ① '떡상 영상' 제외 — 화면 설명은 "알고리즘 떡상 건 제외"였는데 실제로는 단순 평균이라
//      대박 글 하나가 평균 조회수·알고리즘 계수를 끌어올렸다. 이제 그 계정의 **보통 조회수(중앙값)의
//      3배가 넘는 글**을 빼고 평균한다. (예: 3·4·5·5·60만 → 60만 제외 → 4.25만. 옛 방식 15.4만)
//      적용: 총 평균 조회수·총 평균 도달수·알고리즘 계수. 100만뷰 개수는 떡상을 세는 지표라 그대로.
//   ② 유튜브는 쇼츠만(화면 설명 "최근 30일 Shorts"대로) — 호출부가 isShort 로 거른 뒤 넘긴다.
//   ③ 광고 효율 = 광고 평균 − **일반** 평균(설명대로). 화면이 general_avg_play_count 로 계산한다.
// 새 공식으로 계산된 행은 criteria_snapshot.formula = SCREENING_FORMULA 로 표시된다(옛 행 구분용).

export const SCREENING_FORMULA = "v2-typical-avg";
/** 보통 조회수(중앙값)의 몇 배를 '넘으면' 떡상으로 보고 평균에서 뺄지. */
export const OUTLIER_MULTIPLIER = 3;
const SCREENING_DAYS = 30;

type Post = Record<string, unknown>;

// 화이트리스트: 해당 키워드 있으면 자발적 언급으로 간주 → 광고 여부 체크 없이 수집
const ORGANIC_WHITELIST = ['내돈내산'];

export function isAd(post: Post): boolean {
  // 캡션 필드는 플랫폼마다 다름 (IG=caption, 틱톡=text, 트위터=fullText/text)
  const caption = String(post.caption ?? post.text ?? post.fullText ?? '').toLowerCase();
  // 해시태그: IG는 문자열 배열, 틱톡/트위터는 객체 배열({name|title|text}) → 형태 무관하게 문자열 추출
  const hashtags = (Array.isArray(post.hashtags) ? post.hashtags : [])
    .map((h) => (typeof h === 'string' ? h : String((h as Post)?.name ?? (h as Post)?.title ?? (h as Post)?.text ?? '')))
    .filter(Boolean)
    .map((h) => h.toLowerCase());
  const fullText = caption + ' ' + hashtags.join(' ');

  // 내돈내산 있으면 자발적 언급 → 비광고
  if (ORGANIC_WHITELIST.some(k => fullText.includes(k))) return false;

  // (광고) 또는 #광고 패턴만 제외 ("광고 아님" 같은 경우는 통과)
  if (fullText.includes('(광고)') || fullText.includes('#광고')) return true;

  // 기존: #협찬 #ad #sponsored 해시태그 제외
  const adHashtags = new Set(['협찬', 'ad', 'sponsored']);
  return hashtags.some(h => adHashtags.has(h));
}

export function isReel(post: Post): boolean {
  // profile-scraper: productType === 'clips'
  // hashtag-scraper: type === 'Video' or isVideo === true
  return post.productType === 'clips'
    || post.type === 'Video'
    || post.type === 'GraphSidecar' // 슬라이드 릴스
    || post.isVideo === true
    || post.mediaType === 'VIDEO';
}

export function isShort(post: Post): boolean {
  return ((post.url as string) || '').includes('/shorts/');
}

function parseTimestamp(ts: string | number | null | undefined): Date {
  if (!ts) return new Date(0);
  if (typeof ts === 'number') return new Date(ts * 1000);
  return new Date((ts as string).replace('Z', '+00:00'));
}

function avg(posts: Post[], field: string, ndigits = 0): number | null {
  const vals = posts.map(p => p[field] as number).filter(v => v != null);
  if (!vals.length) return null;
  const result = vals.reduce((a, b) => a + b, 0) / vals.length;
  return ndigits ? Math.round(result * 10 ** ndigits) / 10 ** ndigits : Math.round(result);
}

function ratioAvg(posts: Post[], num: string, den: string): number | null {
  const ratios = posts
    .filter(p => p[num] != null && (p[den] as number) > 0)
    .map(p => ((p[num] as number) / (p[den] as number)) * 100);
  if (!ratios.length) return null;
  return Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 10000) / 10000;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * 떡상 글을 뺀 게시물 목록. 조회수(videoPlayCount)가 **중앙값 × 3 을 넘는** 글만 뺀다.
 * 조회수가 없는 글(사진)은 그대로 둔다 — 평균 계산에서 어차피 빠진다.
 * 중앙값이 0이면 빼지 않는다(조회수 있는 글이 전부 떡상으로 잘리는 것을 막는다).
 */
export function excludeOutlierPosts(posts: Post[]): { typical: Post[]; excluded: number } {
  const plays = posts.map(p => p.videoPlayCount).filter((v): v is number => typeof v === 'number');
  const med = median(plays);
  if (med == null || med <= 0) return { typical: posts, excluded: 0 };
  const limit = med * OUTLIER_MULTIPLIER;
  const typical = posts.filter(p => !(typeof p.videoPlayCount === 'number' && p.videoPlayCount > limit));
  return { typical, excluded: posts.length - typical.length };
}

/** 팔로워 대비 평균 조회수(= 알고리즘 계수). 소수 둘째 자리. 팔로워를 모르면 null. */
export function viewsPerFollower(avgPlay: number | null, followers: number): number | null {
  return avgPlay != null && followers > 0 ? Math.round((avgPlay / followers) * 100) / 100 : null;
}

export function calcMetrics(profile: Post, posts: Post[], now: Date = new Date()) {
  const followers = (profile?.followers as number) || 0;
  const cutoff = new Date(now.getTime() - SCREENING_DAYS * 24 * 60 * 60 * 1000);
  const recent = posts.filter(p => parseTimestamp(p.timestamp as string | number) >= cutoff);
  const adPosts = recent.filter(isAd);
  const generalPosts = recent.filter(p => !isAd(p));
  const { typical, excluded } = excludeOutlierPosts(recent);
  const totalPlay = avg(typical, 'videoPlayCount');
  return {
    followers,
    avg_views_per_follower: viewsPerFollower(totalPlay, followers),
    count_1m_view: recent.filter(p => ((p.videoPlayCount as number) || 0) >= 1_000_000).length,
    total_posts: recent.length,
    general_posts: generalPosts.length,
    ad_posts: adPosts.length,
    total_avg_view_count: avg(typical, 'videoViewCount'),
    general_avg_view_count: avg(generalPosts, 'videoViewCount'),
    ad_avg_view_count: avg(adPosts, 'videoViewCount'),
    total_avg_play_count: totalPlay,
    general_avg_play_count: avg(generalPosts, 'videoPlayCount'),
    ad_avg_play_count: avg(adPosts, 'videoPlayCount'),
    total_avg_like_count: avg(recent, 'likesCount'),
    total_avg_comment_count: avg(recent, 'commentsCount'),
    total_like_ratio: ratioAvg(recent, 'likesCount', 'videoPlayCount'),
    general_like_ratio: ratioAvg(generalPosts, 'likesCount', 'videoPlayCount'),
    ad_like_ratio: ratioAvg(adPosts, 'likesCount', 'videoPlayCount'),
    total_comment_ratio: ratioAvg(recent, 'commentsCount', 'videoPlayCount'),
    general_comment_ratio: ratioAvg(generalPosts, 'commentsCount', 'videoPlayCount'),
    ad_comment_ratio: ratioAvg(adPosts, 'commentsCount', 'videoPlayCount'),
    top_ad_play_count: adPosts.length
      ? Math.max(...adPosts.map(p => (p.videoPlayCount as number) || 0)) : null,
    top_ad_post_url: adPosts.length
      ? (adPosts.reduce((a, b) =>
          ((a.videoPlayCount as number) || 0) > ((b.videoPlayCount as number) || 0) ? a : b
        ).url as string) || null : null,
    avg_video_duration: avg(recent, 'videoDuration', 1),
    /** DB 컬럼이 아니다 — 호출부가 criteria_snapshot 에 옮겨 담는다. */
    outliers_excluded: excluded,
  };
}

export type ScreeningMetrics = ReturnType<typeof calcMetrics>;

export function calcTypeMetrics(profile: Post, posts: Post[], platform: string, now: Date = new Date()) {
  const result: Record<string, ScreeningMetrics> = {};
  if (platform === 'instagram') {
    const reels = posts.filter(isReel);
    const feed = posts.filter(p => !isReel(p));
    if (reels.length) result.reels = calcMetrics(profile, reels, now);
    if (feed.length) result.feed = calcMetrics(profile, feed, now);
  } else if (platform === 'youtube') {
    const longform = posts.filter(p => !isShort(p));
    const shorts = posts.filter(isShort);
    if (longform.length) result.longform = calcMetrics(profile, longform, now);
    if (shorts.length) result.shorts = calcMetrics(profile, shorts, now);
  }
  return result;
}

/**
 * 화면 '광고 효율' = (광고 평균 − 일반 평균) ÷ 10,000. 설명문과 같은 식(2026-11-20).
 * 옛 화면은 '총 평균'을 빼서 설명과 달랐고, 총 평균이 떡상 제외로 바뀌면 의미가 더 흐려진다.
 */
export function adEfficiency(m: { ad_avg_play_count?: number | null; general_avg_play_count?: number | null } | null | undefined): number | null {
  if (m?.ad_avg_play_count == null || m.general_avg_play_count == null) return null;
  return (m.ad_avg_play_count - m.general_avg_play_count) / 10000;
}

/** 자동 계산된 행인데 옛 공식(떡상 포함·유튜브 롱폼 혼합)으로 계산됐는지. 수기 입력 행(스냅샷 없음)은 false. */
export function isLegacyScreening(m: { criteria_snapshot?: unknown } | null | undefined): boolean {
  const snap = m?.criteria_snapshot as { formula?: unknown } | null | undefined;
  return !!snap && snap.formula !== SCREENING_FORMULA;
}
