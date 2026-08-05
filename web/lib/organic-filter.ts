/**
 * 무상노출 자동수집 제외 필터.
 *
 * 배경: 검색어가 `라라스윗`/`lalasweet`인데, **인디 듀오 '랄라스윗(lalasweet)'** 이 영문 표기를
 * 우리 브랜드와 똑같이 쓴다. 그래서 밴드 음악 게시물이 무상노출로 섞여 들어왔다(실측 16건, 전부 X).
 * 2026-08-04 사용자 요청으로 자동수집 단계에서 걸러낸다.
 *
 * ⚠️ 수동 추가(POST /api/organic-mentions)와 CSV 업로드에는 적용하지 않는다 — 사람이 일부러
 * 넣는 경우를 막지 않기 위해서다. 이 필터는 Apify 결과를 받는 자동수집 경로 전용이다.
 */
/**
 * 제외어 목록.
 *
 * `랄라스윗`만으로는 **영문 `lalasweet`만 쓴 밴드 게시물**을 못 걸러서(로마자가 우리 브랜드와 동일)
 * 2026-08-05 사용자 지시로 **밴드 곡명 4개**를 추가했다.
 *
 * ⚠️ `오월`·`불꽃놀이`는 일상어다. 넣기 전 실측(전체 672행)으로 오탐을 확인했다:
 *    `오월` 1건(그것도 TWICE 커버 = 밴드 글), `불꽃놀이`·`나의 낡은 오렌지나무`·`파란달이 뜨는 날에` 0건.
 *    즉 현재 데이터에서 오탐 0건이다. 다만 앞으로 "불꽃놀이 보면서 라라스윗 먹기"처럼
 *    **곡명과 겹치는 정상 게시물은 제외될 수 있다.** 그런 사례가 보이면 해당 곡명만 빼거나,
 *    곡명은 `lalasweet`/`랄라스윗`이 함께 있을 때만 적용하도록 조건부로 바꾸면 된다.
 */
export const ORGANIC_EXCLUDE_KEYWORDS = [
  "랄라스윗",
  // 밴드 랄라스윗 곡명
  "오월",
  "나의낡은오렌지나무",      // 공백 제거 형태로 둔다(판정도 공백을 지우고 비교한다)
  "불꽃놀이",
  "파란달이뜨는날에",
];

/**
 * 아이돌 특전 포카 **양도·판매글** 제외 (2026-08-05 사용자 지시).
 *
 * 배경: `다크문 x 라라스윗 아이스크림 케이크`(엔하이픈 콜라보)에 포토카드 특전이 붙어서,
 * X에 **포카 양도·딜·공동구매 글**이 대량으로 올라오고 검색어 `lalasweet`에 걸려 무상노출로
 * 들어왔다. 실측 668행 중 **58건**(전부 X)이 그것이었고 삭제했다.
 *
 * ⚠️ **`다크문`만으로는 절대 제외하지 않는다.** 다크문 콜라보는 실제 제품이라 공식계정·기사·
 *    팬 반응 같은 **진짜 브랜드 노출글이 섞여 있다**(실측 26건). 그래서
 *    **거래 신호 AND 아이돌 문맥**이 동시에 있을 때만 제외한다.
 *    실측 검증: 이 규칙으로 거래글 55건이 잡히고 진짜 노출글 26건은 하나도 안 잡혔다.
 */
const TRADE_SIGNALS = [
  // 한국어
  "양도", "판매", "포카", "포토카드", "특전", "교환", "일괄", "택포", "선입금", "나눔",
  // 영어 팬덤 약어
  "wts", "wtt", "wtb", "ensell", "for sale", "lucky draw", "럭드", "럭키드로우",
  // 태국어(엔하이픈 팬덤 거래글이 특히 많다): 즉시배송/딜/가격/예약/장당/마켓
  "พร้อมส่ง", "ดีล", "ราคา", "จอง", "ใบละ", "ตลาดนัด",
];
const IDOL_CONTEXT = [
  "엔하이픈", "enhypen", "다크문", "dark moon", "darkmoon",
  "포카", "트카", "럭드", "위버스", "weverse", "ktown", "withmuu", "musicplant",
];

/** 거래 신호와 아이돌 문맥이 함께 있으면 그 근거를 돌려준다(없으면 null). */
export function organicTradePostHit(post: Record<string, unknown>): { trade: string; idol: string } | null {
  // ⚠️ 여기서는 **필드를 합쳐서** 본다(제외어와 달리 두 신호가 캡션·해시태그에 나뉘어 있을 수 있다).
  const blob = textCandidates(post).join(" ").toLowerCase();
  const trade = TRADE_SIGNALS.find(k => blob.includes(k));
  if (!trade) return null;
  const idol = IDOL_CONTEXT.find(k => blob.includes(k));
  if (!idol) return null;
  return { trade, idol };
}

/** 문자열 후보에서 사람이 읽는 텍스트만 뽑아낸다(플랫폼마다 필드 모양이 달라 객체도 받는다). */
function textCandidates(post: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      for (const key of ["name", "userName", "username", "title", "text", "nickName"]) {
        if (typeof o[key] === "string") out.push(o[key] as string);
      }
    }
  };
  // handleOrganic의 플랫폼 분기가 캡션·제목·계정명으로 쓰는 필드를 모두 본다.
  for (const key of [
    "caption", "text", "fullText", "title", "description", "details",
    "author", "authorMeta", "username", "ownerUsername", "channelName", "channelTitle", "blogName",
  ]) {
    push(post[key]);
  }
  for (const h of Array.isArray(post.hashtags) ? post.hashtags : []) push(h);
  return out;
}

/**
 * 게시물 텍스트/계정명에 제외어가 있으면 그 제외어를 돌려준다(없으면 null).
 *
 * 공백은 필드 단위로 지워 `랄라 스윗` 표기까지 잡는다.
 * ⚠️ 필드를 이어붙인 뒤 공백을 지우면 앞 필드 끝 `…랄라` + 뒤 필드 앞 `스윗…`이 붙어 오탐이 난다.
 *    그래서 반드시 필드별로 검사한다.
 */
export function organicExcludeHit(post: Record<string, unknown>): string | null {
  for (const raw of textCandidates(post)) {
    const squashed = raw.replace(/\s+/g, "");
    for (const kw of ORGANIC_EXCLUDE_KEYWORDS) {
      if (squashed.includes(kw)) return kw;
    }
  }
  return null;
}
