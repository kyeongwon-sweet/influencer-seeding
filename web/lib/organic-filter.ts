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
export const ORGANIC_EXCLUDE_KEYWORDS = ["랄라스윗"];

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
