/**
 * 무상노출 수동 추가 시 자동 보강 — 게시일 · 채널 유형 · 언급 제품 · 조회수.
 *
 * 사용자 요청(2026-08-06): "수동으로 추가하면 자동으로 날짜, 채널 유형(가능한 것만),
 * 상품명(가능한 것만), 조회수가 업데이트되게".
 *
 * 설계 원칙
 *  1. **빈 칸만 채운다.** 사람이 입력한 값은 절대 덮지 않는다(수기 입력이 자동값에 지워지는 사고 방지).
 *  2. **못 알아내면 비워둔다.** 지어내지 않는다(절대 규칙). 그래서 반환 타입에 null이 정상값이다.
 *  3. **조회수는 역행 금지.** 기존값보다 작은 값은 쓰지 않는다(수집 오류가 실측을 깎는 사고 방지).
 *  4. 액터는 **협찬 모니터링이 쓰는 것과 동일**한 것을 재사용한다(검증된 것 + 비용 예측 가능).
 */

/** 플랫폼별 Apify 액터와 단건 입력. 블로그·스레드는 조회수 개념이 없어 대상에서 뺀다. */
const ACTOR: Record<string, { id: string; input: (url: string) => Record<string, unknown> }> = {
  "유튜브": {
    id: "streamers/youtube-scraper",
    input: (url) => ({ startUrls: [{ url }], maxResults: 1, maxResultsShorts: 1, maxResultStreams: 1 }),
  },
  "트위터": {
    id: "apidojo/twitter-scraper-lite",
    // ⚠️ 끝에 슬래시가 붙으면 이 액터가 'Unsupported URL'로 0건을 낸다(협찬 수집에서 실제로 겪음).
    input: (url) => ({ startUrls: [url.replace(/\/+$/, "")], maxItems: 1 }),
  },
  "인스타그램": {
    id: "apify/instagram-scraper",
    input: (url) => ({ directUrls: [url], resultsLimit: 1, resultsType: "posts" }),
  },
  "틱톡": {
    id: "clockworks/tiktok-scraper",
    input: (url) => ({ postURLs: [url], resultsPerPage: 1 }),
  },
};

export function enrichSupported(platform: string | null | undefined): boolean {
  return !!platform && platform in ACTOR;
}

/** 액터를 동기로 돌려 데이터셋 아이템을 바로 받는다(단건이라 웹훅이 과하다). */
export async function runActorSync(platform: string, url: string, timeoutSecs = 100): Promise<Record<string, unknown>[]> {
  const spec = ACTOR[platform];
  if (!spec) return [];
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error("APIFY_API_TOKEN 없음");
  const res = await fetch(
    `https://api.apify.com/v2/acts/${spec.id.replace("/", "~")}/run-sync-get-dataset-items?timeout=${timeoutSecs}&clean=true&limit=5`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(spec.input(url)),
    },
  );
  if (!res.ok) throw new Error(`Apify 동기실행 실패 [${spec.id}]: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const items = await res.json();
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string" && /^\d[\d,]*$/.test(v.trim())) return Number(v.replace(/,/g, ""));
  return null;
};

/** 플랫폼마다 필드명이 달라 후보 키를 모두 훑는다. 없으면 null(비워둔다). */
export function pickViewCount(item: Record<string, unknown>): number | null {
  for (const k of ["viewCount", "playCount", "videoViewCount", "views", "videoPlayCount", "playsCount", "video_view_count"]) {
    const n = num(item[k]);
    if (n != null) return n;
  }
  const stats = item.statistics as Record<string, unknown> | undefined;
  if (stats) for (const k of ["viewCount", "playCount", "views"]) { const n = num(stats[k]); if (n != null) return n; }
  return null;
}

/** 게시일(YYYY-MM-DD). 미래 날짜·1970년 같은 쓰레기값은 버린다. */
export function pickUploadedAt(item: Record<string, unknown>, todayISO: string): string | null {
  for (const k of ["uploadDate", "createdAt", "date", "publishedAt", "createTimeISO", "timestamp", "taken_at_timestamp"]) {
    const v = item[k];
    let d: Date | null = null;
    if (typeof v === "number") d = new Date(v > 1e12 ? v : v * 1000);   // 초/밀리초 자동 판별
    else if (typeof v === "string" && v.trim()) d = new Date(v);
    if (!d || Number.isNaN(d.getTime())) continue;
    const iso = d.toISOString().slice(0, 10);
    if (iso < "2015-01-01" || iso > todayISO) continue;                  // 범위 밖은 신뢰하지 않는다
    return iso;
  }
  return null;
}

/**
 * 썸네일 URL. **만료되지 않는 호스트만** 저장한다.
 *
 * 실측(2026-08-06): 저장돼 있던 인스타 썸네일 6건이 **전부 403**이었다(적재 후 6주 만에 만료).
 * `scontent*.cdninstagram.com`은 서명(signature) 붙은 임시 URL이라 저장해도 곧 깨진 이미지가 된다.
 * 반면 `pbs.twimg.com`(X)·`i.ytimg.com`(유튜브)은 서명이 없어 계속 살아있다(HEAD 200 확인).
 * → 만료되는 호스트는 **아예 저장하지 않는다**(깨진 이미지를 DB에 남기지 않는다).
 */
const EXPIRING_IMAGE_HOST = /cdninstagram\.com$|fbcdn\.net$|tiktokcdn|byteoversea/i;

export function pickThumbnail(item: Record<string, unknown>): string | null {
  const cands: unknown[] = [];
  for (const k of ["thumbnailUrl", "displayUrl", "thumbnail", "coverUrl", "imageUrl", "previewImage", "image"]) cands.push(item[k]);
  // 배열/중첩 후보
  const thumbs = item.thumbnails;
  if (Array.isArray(thumbs)) for (const t of thumbs) {
    if (typeof t === "string") cands.push(t);
    else if (t && typeof t === "object") cands.push((t as { url?: unknown }).url);
  }
  const media = item.media;
  if (Array.isArray(media)) for (const m of media) {
    if (m && typeof m === "object") cands.push((m as { media_url_https?: unknown; url?: unknown }).media_url_https ?? (m as { url?: unknown }).url);
  }
  const vm = item.videoMeta as Record<string, unknown> | undefined;
  if (vm) cands.push(vm.coverUrl, vm.originalCoverUrl);
  const images = item.images;
  if (Array.isArray(images) && typeof images[0] === "string") cands.push(images[0]);

  for (const c of cands) {
    if (typeof c !== "string" || !/^https?:\/\//i.test(c)) continue;
    let host: string;
    try { host = new URL(c).hostname; } catch { continue; }
    if (EXPIRING_IMAGE_HOST.test(host)) continue;   // 만료되는 호스트는 버린다
    return c;
  }
  return null;
}

export function pickCaption(item: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const k of ["text", "fullText", "caption", "title", "description", "desc"]) {
    if (typeof item[k] === "string") parts.push(item[k] as string);
  }
  const hashtags = Array.isArray(item.hashtags) ? item.hashtags : [];
  for (const h of hashtags) {
    if (typeof h === "string") parts.push(h);
    else if (h && typeof h === "object" && typeof (h as { name?: unknown }).name === "string") parts.push((h as { name: string }).name);
  }
  return parts.join(" ");
}

/**
 * 캡션에서 **이미 쓰이는 제품명만** 찾아낸다(새 이름을 만들지 않는다 → 칩 난립 방지).
 *
 * ⚠️ 일상어와 겹치는 이름은 제외한다. '우유·케이크·라떼'는 캡션에 흔히 나와서
 *    ("우유 마시면서") 오탐이 확실하다. 이런 건 사람이 직접 고르게 둔다.
 * ⚠️ 더 구체적인 이름이 잡히면 짧은 상위 이름은 버린다('바닐라초코바'가 잡히면 '초코바'는 뺀다).
 *    상위 칩은 그룹 선택으로 이미 함께 잡히므로 중복 저장할 이유가 없다.
 */
export const GENERIC_PRODUCT_WORDS = ["우유", "케이크", "라떼", "쉐이크", "요거트바", "파인트", "모나카", "초코바", "제로바", "듬뿍바", "쫀득바", "빵샌드"];

export function productsFromCaption(caption: string, knownNames: string[]): string[] {
  const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  const blob = squash(caption);
  if (!blob) return [];
  const hits = knownNames
    .filter((n) => n && n.length >= 3 && !GENERIC_PRODUCT_WORDS.includes(n))
    .filter((n) => blob.includes(squash(n)));
  // 더 긴(구체적인) 이름에 포함되는 짧은 이름 제거
  return hits.filter((n) => !hits.some((m) => m !== n && squash(m).includes(squash(n)))).sort();
}
