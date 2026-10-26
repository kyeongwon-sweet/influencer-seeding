/**
 * URL 정규화 유틸리티
 *
 * 목적: 모든 페이지에서 일관된 URL 정규화
 * 규칙:
 * 1. 프로토콜: https://로 통일
 * 2. Trailing slash: 반드시 포함 (마지막에 /)
 * 3. 쿼리 파라미터: 모두 제거 (UTM, tracking 등)
 * 4. 플랫폼별 특수 처리:
 *    - YouTube: /shorts, /videos, /featured 등 제거
 *    - Instagram: 프로필만 (포스트/릴스 URL → null)
 *
 * ⚠️ 중요: 모든 URL 비교는 이 함수로 정규화 후 진행!
 */

/**
 * 범용 URL 정규화 함수 (모든 페이지에서 사용)
 * - 프로토콜 + trailing slash + 쿼리 제거 통일
 * - 플랫폼별 추가 정규화는 별도 함수 사용
 */
export function normalizeUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    // 인스타 게시물은 /p/·/reel/·/reels/·/tv/ 가 모두 같은 글 → shortcode로 표준형(/p/<code>/) 통일.
    // (경로만 다른 중복 행 방지 — onConflict:url 이 자동 dedup 하도록. 예: /p/ABC/ 와 /reel/ABC/ 는 동일)
    // instagr.am 단축 호스트도 동일 게시물 → 같은 표준형으로.
    if (u.hostname.includes("instagram.com") || u.hostname.includes("instagr.am")) {
      const m = u.pathname.match(/\/(?:p|reels|reel|tv)\/([A-Za-z0-9_-]+)/);
      if (m) return `https://www.instagram.com/p/${m[1]}/`;
    }
    // 유튜브 영상: ID가 쿼리(watch?v=)·단축호스트(youtu.be)에 있어서 아래 일반 규칙(쿼리 제거)을 타면
    // ID가 통째로 소실됨 → 서로 다른 영상이 "https://www.youtube.com/watch/" 한 행으로 충돌(onConflict).
    // ID를 보존해 표준형으로 통일: shorts는 기존 DB 표준형(/shorts/<id>/) 유지, 그 외(watch·youtu.be·embed·live·v)는 watch?v=<id>.
    {
      const host = u.hostname.toLowerCase();
      if (host === "youtu.be" || host.endsWith("youtube.com")) {
        const mShorts = u.pathname.match(/\/shorts\/([A-Za-z0-9_-]{6,})/);
        if (mShorts) return `https://www.youtube.com/shorts/${mShorts[1]}/`;
        let id: string | null = null;
        if (host === "youtu.be") id = u.pathname.split("/").filter(Boolean)[0] ?? null;
        else {
          const mPath = u.pathname.match(/\/(?:embed|live|v)\/([A-Za-z0-9_-]{6,})/);
          id = mPath ? mPath[1] : (u.pathname.replace(/\/$/, "") === "/watch" ? u.searchParams.get("v") : null);
        }
        if (id && /^[A-Za-z0-9_-]{6,}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
        // ID가 없으면(채널/재생목록 등) 일반 규칙으로 진행
      }
    }
    // 일반(비 IG/YouTube): host 표준화로 www/스킴/이중슬래시 변형 중복을 한 곳에서 차단(틱톡·X·페북·스레드 등).
    //   - 선행 www. 만 제거(m.blog.naver.com 같은 유의미 서브도메인은 보존) + host 소문자
    //   - 경로 // 이중슬래시 축약 + trailing slash 강제
    //   ⚠️ scripts/notify_status.py 의 _canon_url(파이썬 이식)과 반드시 동기화할 것.
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    let path = u.pathname.replace(/\/{2,}/g, "/");
    path = path.endsWith("/") ? path : path + "/";
    if (host === "tiktok.com") return `https://www.tiktok.com${path}`;
    return `https://${host}${path}`;
  } catch {
    return null;
  }
}

/**
 * Stable identity key for a single post across URL variants.
 *
 * This is stricter than normalizeUrl(): it intentionally ignores path spelling
 * such as Instagram /reel/ vs /p/ and host spelling such as TikTok www.
 * Use this for DB uniqueness and Sheet<->DB matching.
 */
export function postIdentityKey(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith("http") ? url : "https://" + url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");

    if (host.includes("instagram.com") || host.includes("instagr.am")) {
      const m = u.pathname.match(/\/(?:p|reels|reel|tv)\/([A-Za-z0-9_-]+)/);
      if (m) return `ig:${m[1]}`;
    }

    if (host.includes("tiktok.com")) {
      const m = u.pathname.match(/\/(?:video|photo)\/(\d+)/);
      if (m) return isValidTikTokSnowflake(m[1]) ? `tt:${m[1]}` : null;
    }

    if (host === "youtu.be" || host.endsWith("youtube.com")) {
      const shorts = u.pathname.match(/\/shorts\/([A-Za-z0-9_-]{6,})/);
      if (shorts) return `yt:${shorts[1]}`;
      const pathId = u.pathname.match(/\/(?:embed|live|v)\/([A-Za-z0-9_-]{6,})/);
      const id = host === "youtu.be"
        ? u.pathname.split("/").filter(Boolean)[0]
        : pathId?.[1] ?? (u.pathname.replace(/\/$/, "") === "/watch" ? u.searchParams.get("v") : null);
      if (id && /^[A-Za-z0-9_-]{6,}$/.test(id)) return `yt:${id}`;
    }

    const normalized = normalizeUrl(url);
    return normalized ? `url:${normalized}` : null;
  } catch {
    return null;
  }
}

/**
 * 협찬 게시물 추가 시 허용하는 플랫폼 URL (인스타 / 유튜브 / 틱톡 / 페이스북 / 스레드 / X(트위터) / 카카오 숏폼 / 네이버 클립, 다단계 서브도메인 포함).
 * sync · bulk · stats-import 및 Apps Script(Sponsored_Posts_Sync.gs)가 동일 기준 사용.
 * 서브도메인은 `*`(0개 이상) — 네이버 클립이 m.blog.naver.com처럼 2단계라 필요. 도메인 뒤 `/` 앵커로 evil-naver.com 등은 차단됨.
 */
export const ALLOWED_POST_URL_RE = /^https:\/\/([a-z0-9-]+\.)*(instagram\.com|youtube\.com|youtu\.be|tiktok\.com|facebook\.com|threads\.com|threads\.net|x\.com|twitter\.com|t\.co|kakao\.com|naver\.com)\//i;

// TikTok 게시물 ID는 unsigned 64-bit snowflake다. 자릿수만 19로 고정하면 미래의
// 정상 20자리 ID까지 막으므로 uint64 최댓값과 문자열로 비교한다(BigInt 없는 GAS와 동일 규칙).
const MAX_TIKTOK_SNOWFLAKE = "18446744073709551615";

export function isValidTikTokSnowflake(id: string): boolean {
  if (!/^\d+$/.test(id)) return false;
  const normalized = id.replace(/^0+/, "") || "0";
  return normalized.length < MAX_TIKTOK_SNOWFLAKE.length ||
    (normalized.length === MAX_TIKTOK_SNOWFLAKE.length && normalized <= MAX_TIKTOK_SNOWFLAKE);
}

/** TikTok video/photo URL인데 게시물 ID가 uint64 범위를 벗어나면 잘못 붙인 URL로 판정한다. */
export function isInvalidTikTokPostUrl(url: string): boolean {
  const raw = String(url || "");
  if (!/tiktok\.com/i.test(raw) && !/^tt:/i.test(raw)) return false;
  const match = raw.match(/\/(?:video|photo)\/(\d+)/i) ?? raw.match(/^tt:(\d+)$/i);
  return Boolean(match && !isValidTikTokSnowflake(match[1]));
}

/**
 * Instagram URL이지만 특정 게시물 shortcode가 없는 프로필·목록 URL인지 판정한다.
 * 이런 URL은 수집할 수 없으므로 모든 sponsored-post 쓰기 입구에서 차단한다.
 */
export function isInstagramNonPostUrl(url: string): boolean {
  const u = String(url || "");
  return /instagram\.com/i.test(u) && !/\/(p|reels|reel|tv)\/[A-Za-z0-9_-]+/i.test(u);
}

/**
 * 틱톡 단축링크(`vt.tiktok.com/…`, `vm.tiktok.com/…`)인지. 영상 ID가 주소에 없어 해석(리다이렉트) 전에는
 * 어떤 글인지 알 수 없다. 서버는 쓰기 때 풀어 정식 주소로 저장하지만 시트(Apps Script)는 못 풀어,
 * 같은 글이 시트에 단축·정식 두 줄로 생겼다(2026-09 51건, 2026-10-13 8건 재발).
 */
export function isTikTokShortLink(url: string): boolean {
  return /^(?:https?:\/\/)?(?:vt|vm)\.tiktok\.com\/[A-Za-z0-9]+\/?(?:[?#].*)?$/i.test(String(url || "").trim());
}

/**
 * TikTok 프로필(`tiktok.com/@계정/`)·YouTube 채널(`youtube.com/@계정/shorts/`, `/channel/…`) 주소인지 판정한다.
 * 게시물이 아니라 수집도 안 되는데, 한 번 DB에 들어가면 시트에서 지워도 pullFromDB가 종료글까지
 * 다시 붙여 되살아난다(2026-10-13 썰뜨기(틱톡)·이슈박스(유튜브) 실측). 게시물 ID가 있으면 통과.
 * 단축링크(vt/vm, /t/)나 옛 형식(m.tiktok.com/v/…)은 계정 주소가 아니므로 건드리지 않는다.
 */
export function isAccountNonPostUrl(url: string): boolean {
  const raw = String(url || "");
  try {
    const u = new URL(raw.startsWith("http") ? raw : "https://" + raw);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "tiktok.com" || host === "m.tiktok.com") {
      return /^\/@[^/]+\/?$/.test(u.pathname);
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (postIdentityKey(raw)?.startsWith("yt:")) return false;
      return /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)(\/|$)/.test(u.pathname);
    }
    return false;
  } catch {
    return false;
  }
}

export function normalizeYouTubeUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (!u.hostname.includes('youtube.com')) return null;
    // /shorts/xxx, /videos, /featured 등 제거
    let path = u.pathname.replace(/\/(shorts|videos|featured|community|about)(\/.*)?$/, '');
    path = path.replace(/\/$/, '');
    if (!path || path === '') path = '/';
    return `https://www.youtube.com${path}/`;
  } catch {
    return null;
  }
}

// 포스트 URL 경로 세그먼트 (username이 아님)
const IG_POST_PREFIXES = new Set(['reels', 'reel', 'p', 'tv', 'stories', 'explore', 'accounts', 'ar', 'direct']);

export function normalizeInstagramUrl(url: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (!u.hostname.includes('instagram.com')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    const first = parts[0];
    // 포스트/릴스 URL이면 프로필 URL이 아님 → null 반환
    if (!first || IG_POST_PREFIXES.has(first.toLowerCase())) return null;
    return `https://www.instagram.com/${first}/`;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 무상노출(organic_mentions) 링크 중복 판정
//
// 요구(2026-08-04): "링크가 같은 게시글은 추가되지 않게. 뒤에 필요없는 utm이 붙어도 자동 중복 처리."
// 위 `normalizeUrl`이 쿼리스트링을 통째로 버리므로 `?utm_source=`·`?igsh=`·`?fbclid=` 등은 자동으로
// 사라지고, 인스타 `/reel/`↔`/p/`·`www.` 유무·trailing slash 차이도 한 형태로 접힌다.
// (유튜브 `watch?v=<id>`는 ID가 쿼리에 있어 normalizeUrl이 예외로 보존한다)
//
// ⚠️ 중복 판정은 **정규화된 값끼리** 비교할 것. 노션 임포트가 원본 문자열로 비교해서, 같은 글이라도
//    파라미터가 붙으면 새 행으로 들어가던 문제가 있었다.
// (여기 두는 이유: lib 간 상대 import는 tsc가 확장자 없는 경로만 허용하는데 테스트 러너는 확장자를
//  요구해 서로 충돌한다. URL 정규화의 집인 이 파일에 함께 두면 양쪽 다 문제없다.)
// ═══════════════════════════════════════════════════════════════

export type Mentionish = Record<string, unknown> & { url?: unknown };

/** 저장·비교용 표준 URL. 정규화가 실패하면(형식 이상) 원본을 그대로 쓴다. */
export function canonicalMentionUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  return normalizeUrl(trimmed) ?? trimmed;
}

/**
 * 중복 판정 키 — **URL이 글을 특정하는가**에 따라 달라진다.
 *
 * 왜 필요한가(2026-09-21 실측): 인스타 스토리는 영구 링크가 없어 노션·수기 모두 **프로필 주소**
 * (`instagram.com/<계정>/`)로 기록한다. 그런데 URL만으로 중복을 보면 **같은 계정의 서로 다른 날짜
 * 노출이 한 건으로 묻힌다** — `운동하는 쩡`(jungyun_diet)의 2023-02-12(파인트)와 2023-11-30(초코바)가
 * 그렇게 1건만 들어갔다. 프로필 URL은 '계정'을 가리킬 뿐 '그 글'을 가리키지 않기 때문이다.
 *
 * 그래서 **프로필형 URL에 한해** 업로드일자를 키에 더한다. 게시물 URL(`/p/`·`/reel/`·유튜브 등)은
 * URL 자체가 글의 정체성이므로 종전대로 URL만 쓴다 — 날짜를 섞으면 같은 글이 날짜만 다르게
 * 두 번 들어간다(수기 입력·재수집에서 흔하다).
 *
 * ⚠️ 날짜를 모르면 URL만으로 판정한다. 모르는 채 키를 갈라놓으면 **같은 노출이 중복 적재**된다 —
 *    빠뜨리는 쪽보다 겹치는 쪽이 되돌리기 어렵다(계정·조회수가 뒤섞인다).
 */
export function mentionDedupeKey(item: Mentionish | string): string | null {
  const raw = typeof item === "string" ? item : item.url;
  const key = canonicalMentionUrl(raw);
  if (!key) return null;
  if (typeof item === "string" || !isInstagramNonPostUrl(key)) return key;
  const uploaded = item.uploaded_at;
  const day = typeof uploaded === "string" ? uploaded.slice(0, 10) : "";
  // 구분자 `#`은 정규화된 URL에 남지 않으므로(프래그먼트 제거) 실제 주소와 충돌하지 않는다.
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${key}#uploaded=${day}` : key;
}

/**
 * 검색창에 **링크를 붙여 넣었는지** 판정하고, 그렇다면 표준 URL을 돌려준다(아니면 null).
 *
 * 왜(2026-10-26): 추가하려던 X 링크가 '이미 등록됨'으로 막혔는데 목록에서 못 찾았다. 행은 계정명이
 * '원어스 건희'로 저장돼 있었고, 검색은 계정명만 봐서 링크·아이디(P_kh627)로는 안 걸렸다.
 * 링크 검색은 중복 판정과 **같은 표준화(`canonicalMentionUrl`)** 로 비교해야 "등록돼 있다는데
 * 검색에는 안 나오는" 어긋남이 다시 생기지 않는다(utm·/reel/·www 변형도 같은 글로 잡힌다).
 */
export function mentionLinkQuery(query: string | null | undefined): string | null {
  const q = (query ?? "").trim();
  // 공백·쉼표가 있으면 일반 검색어(AND/OR 문법)다. 링크는 한 덩어리로 붙여 넣는다.
  if (!q || /[\s,]/.test(q)) return null;
  if (!/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}\//i.test(q)) return null;
  return canonicalMentionUrl(q);
}

/**
 * 게시물 URL에 들어 있는 **계정 아이디**(소문자, `@` 없음). 없으면 null.
 * 계정명 칸에는 사람이 붙인 이름('원어스 건희')이 들어가 아이디로는 못 찾기 때문에, 검색 대상에 더한다.
 *  - `@아이디` 경로(틱톡·유튜브·스레드): 그 조각
 *  - X/트위터: 첫 경로 조각(`x.com/<아이디>/status/…`)
 *  - 인스타 프로필·스토리: `instagram.com/<아이디>/`, `instagram.com/stories/<아이디>/…`
 *    (게시물 `/p/<코드>/` 에는 아이디가 없다)
 */
export function mentionUrlHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.startsWith("http") ? url : "https://" + url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const at = parts.find((p) => p.startsWith("@") && p.length > 1);
  if (at) return decodeURIComponent(at.slice(1)).toLowerCase();
  const first = parts[0]?.toLowerCase();
  if (!first) return null;
  if (host === "x.com" || host === "twitter.com") {
    const reserved = ["i", "home", "search", "hashtag", "intent", "explore", "share"];
    return reserved.includes(first) ? null : first;
  }
  if (host.endsWith("instagram.com")) {
    if (first === "stories") return parts[1]?.toLowerCase() ?? null;
    return ["p", "reel", "reels", "tv", "explore"].includes(first) ? null : first;
  }
  return null;
}

/** 중복 409 안내 문구 — 어느 행과 겹쳤는지 이름·날짜로 알려 준다(목록에서 바로 찾을 수 있게). */
export function duplicateMentionMessage(existing: Mentionish | null | undefined): string {
  const name = typeof existing?.account_name === "string" ? existing.account_name.trim() : "";
  const day = typeof existing?.uploaded_at === "string" ? existing.uploaded_at.slice(0, 10) : "";
  if (name) return `이미 '${name}'${day ? `(${day})` : ""} 행으로 등록돼 있습니다.`;
  return `이미 등록돼 있습니다(계정명 비어 있음${day ? `, ${day}` : ""}).`;
}

export type SplitResult<T> = {
  /** 저장할 항목(url이 정규화된 상태) */
  unique: T[];
  /**
   * 이미 있거나 같은 요청 안에서 겹친 항목.
   * `existing` = 겹친 **기존 행**(reason='existing'이고 기존 목록을 객체로 넘겼을 때만) — 화면이 그 행을 짚어 준다.
   */
  duplicates: Array<{ item: T; url: string; reason: "existing" | "in_batch"; existing?: Mentionish }>;
  /** 링크가 비어 판정 불가한 항목 */
  invalid: T[];
};

/**
 * 들어온 목록을 (저장할 것 / 중복 / 무효)로 가른다.
 * @param items    요청 본문의 항목들
 * @param existing 이미 저장된 항목(정규화 여부 무관 — 여기서 다시 정규화해 비교).
 *   ⚠️ 프로필 URL은 URL+업로드일자로 식별하므로(`mentionDedupeKey`) **`{url, uploaded_at}` 형태로
 *   넘겨야** 같은 계정의 다른 날짜 노출이 중복으로 묻히지 않는다. 문자열만 넘기면 URL만으로 비교한다
 *   — 그 경우 프로필 URL 신규분이 기존 1건에 전부 흡수된다.
 */
export function splitDuplicateMentions<T extends Mentionish>(
  items: T[],
  existing: Iterable<string | Mentionish>,
): SplitResult<T> {
  const seen = new Set<string>();
  // 날짜를 모르는 기존 행은 그 URL의 **모든 날짜**를 덮는다. 같은 프로필의 다른 노출을 놓칠 수는
  // 있어도, 같은 노출을 두 번 적재하는 것보다 낫다(계정·조회수가 뒤섞이면 되돌리기 어렵다).
  const seenAnyDate = new Set<string>();
  // 키 → 기존 행(객체로 넘어온 것만). 중복 안내에서 "어느 행과 겹쳤는지"를 짚기 위해서다.
  const rowByKey = new Map<string, Mentionish>();
  const rowByAnyDate = new Map<string, Mentionish>();
  for (const row of existing) {
    const key = mentionDedupeKey(row);
    if (!key) continue;
    seen.add(key);
    if (typeof row !== "string" && !rowByKey.has(key)) rowByKey.set(key, row);
    // 키가 canonical 그대로면 = 날짜가 키에 안 붙은 행이다(게시물 URL이거나 날짜 미상).
    if (key === canonicalMentionUrl(typeof row === "string" ? row : row.url)) {
      seenAnyDate.add(key);
      if (typeof row !== "string" && !rowByAnyDate.has(key)) rowByAnyDate.set(key, row);
    }
  }

  // 이번 배치에서 unique로 채택된 canonical 키 — in_batch/existing 판정을 O(1)로(기존 out.unique 전체 재순회 O(n²) 제거).
  const batchKeys = new Set<string>();
  const out: SplitResult<T> = { unique: [], duplicates: [], invalid: [] };
  for (const item of items) {
    const key = mentionDedupeKey(item);
    // ⚠️ 비교에 쓰는 key(프로필형은 `URL@날짜`)와 **저장할 URL은 다르다.**
    //    key를 그대로 저장하면 `@2023-11-30`이 붙은 가짜 주소가 DB에 들어가 링크가 깨진다.
    const canonical = canonicalMentionUrl(item.url);
    if (!key || !canonical) {
      out.invalid.push(item);
      continue;
    }
    if (seen.has(key) || seenAnyDate.has(canonical)) {
      // 이미 DB에 있던 것인지, 이번 요청 안에서 겹친 것인지 구분해 메시지를 정확히 낸다.
      const reason = batchKeys.has(key) ? "in_batch" : "existing";
      const match = reason === "existing" ? (rowByKey.get(key) ?? rowByAnyDate.get(canonical)) : undefined;
      out.duplicates.push(match ? { item, url: canonical, reason, existing: match } : { item, url: canonical, reason });
      continue;
    }
    seen.add(key);
    if (key === canonical) seenAnyDate.add(canonical);
    batchKeys.add(key);
    out.unique.push({ ...item, url: canonical } as T);
  }
  return out;
}

/**
 * Apify에 **요청할 때만** 쓰는 IG URL — 게시물은 `/reel/` 형태로 통일한다.
 *
 * 🚨 2026-08-19 실측: `apify/instagram-scraper`는 같은 게시물이라도 `/p/`로 요청하면
 * `videoPlayCount`를 아예 반환하지 않고, `/reel/`로 요청하면 반환한다
 * (5건 전부 회수: 1,739 / 2,190 / 141 / 1,137 / 2,203 — 브라우저 릴스 탭 실측값과 일치).
 * 이 때문에 DB에 `/p/`로 저장된 릴스가 '좋아요만 있고 조회수 없음'으로 쌓였고,
 * 큐가 이를 `no_public_view_metric`으로 분류해 재시도를 영구 중단할 뻔했다.
 *
 * 사진·캐러셀에 `/reel/`로 요청해도 오류·오값이 없다(4건 실측: 조회수 필드만 비고 나머지 정상).
 *
 * ⚠️ **DB·시트 저장 URL은 절대 바꾸지 않는다** — 요청 시점에만 변환한다(정본 불변).
 * ⚠️ 프로필 URL에는 쓰지 말 것. shortcode가 없으면 원본을 그대로 돌려준다.
 */
export function instagramRequestUrl(url: string): string {
  const m = String(url ?? "").match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? `https://www.instagram.com/reel/${m[1]}/` : url;
}

/**
 * 연동시트 행 주소를 **서버가 실제로 받아주는가** 기준으로 분류한다(formula-audit 의 '시트에만 있는 행' 감사용).
 *
 * 판정 순서는 sponsored-write.ts 의 upsert 와 같다 — 먼저 normalizeUrl 로 정규화하고 그 결과를 검사한다.
 * 그래서 `instagram.com/reel/X/`(https:// 없음)·`http://youtube.com/...` 은 'post' 다. 서버는 받는데
 * Apps Script 가 원본 문자열에 `^https://` 를 걸어 버리던 행이 바로 이것이다(2026-10-13 사고).
 *   · short       — 틱톡 단축주소. 서버는 저장 직전 리다이렉트로 풀지만 감사는 오프라인이라 대조 불가.
 *   · unsupported — 서버도 거부(미지원 도메인·인스타 프로필 링크·잘못된 틱톡 ID 등).
 */
export function classifySheetPostUrl(raw: string): "post" | "short" | "unsupported" {
  const text = String(raw ?? "").trim();
  if (!text) return "unsupported";
  if (/^(https?:\/\/)?v[tm]\.tiktok\.com\//i.test(text)) return "short";
  const url = normalizeUrl(text) || text;
  if (!ALLOWED_POST_URL_RE.test(url) || isInstagramNonPostUrl(url) || isInvalidTikTokPostUrl(url)) return "unsupported";
  return "post";
}
