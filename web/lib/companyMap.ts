// 계정명(인플루언서) → 업체명 자동 매핑.
// 시트에 업체명(company_name)이 없을 때 대시보드에서 표시용 fallback으로 사용.
// 시트 수동 입력값이 항상 우선. 새 계정도 여기 배열에 추가하면 자동 반영.
const COMPANY_ACCOUNTS: Record<string, string[]> = {
  "루나앤코코": [
    "luna.humor", "luna.tip", "luna.daily",
    "luna.besty", "jolly__humor", "nato.tip", "tteokbokki__zip",
    "nato.funny", "nato.healing", "nato.zzal",
    "tree.humor", "tree.playlist", "tree.tving",
    "hana.humor", "hana.tving", "hana.zzal",
    "apple__paper", "grape__paper", "lemon__paper", "mango__paper", "melon__paper",
    "blue_fun_diary", "green_fun_diary", "pink_fun_diary", "purple_fun_diary", "yellow_fun_diary",
    "hachuping_humor", "malangping_zzal", "chachaping_zzal", "ddonutping_zzal",
    "dding_box", "happing_box", "showing_box",
  ],
  "유머패밀리": [
    "Ufo__RED", "Ufo__PINK", "Ufo__ORANGE", "Ufo__NIGHT",
    "Ufo__blue", "Ufo__brown", "Ufo__navy", "Ufo__purple", "Ufo__skyblue",
    "Ufo__gray", "Ufo__green", "Ufo__white", "Ufo__yellow", "Ufo__rainbow",
  ],
  "동후작가": [
    "bol4_pyeong", "ee_pyeong", "ennie_pyeong", "flower_pyeong", "happy__pyeong", "text_pyeong", "two_pyeong",
    "anavocado12345", "flower_words03", "hanjan5940", "ho1y_time", "lifebookcase", "wikitrip",
  ],
  "아택": [
    "smile_ggobuk_s2", "smile_haha_s2", "smile_king_s2", "smile_life_s2", "smile_papa_s2", "smile_today_s2",
    "humor_nyang", "some2lve",
  ],
  "굿띵투유": [
    "365_hot", "365_real", "time_holy", "humor_yonggari", "mamy014", "Pangpang_one_", "eattt.zin",
    "entertainment_yonggari", "graegaja", "hahahohokiki6814", "humor_ssul", "kutbba101",
    "laugh.34", "laugh.35", "mukddoonge", "one_day_humor_diary", "oyes__blue", "today_quest",
    "yes__jam_", "Hoho_cutie_", "Sksk1sksk0", "Sksk1sksk1",
  ],
  "업크루": [
    "dolkki_daily", "guliguli_humor", "happyhappy_pick", "humorphim",
    "pink_humor25", "pink_idolly", "upupupupup_upupup", "zzalqueen",
  ],
  "후마니": [
    "humani_3",
  ],
};

// 사소한 차이(대소문자·공백·밑줄·점·가운뎃점·하이픈)는 같은 채널로 취급한다(사용자 규칙 2026-08-18).
// 한글 계정명은 보존하고 구분기호만 제거 → 예: "Ufo_RED"·"ufo__red"·"Ufo RED" 모두 같은 키.
export function canonAccount(name?: string | null): string {
  return String(name ?? "").toLowerCase().replace(/[\s._·-]/g, "");
}
const _BY_ACCOUNT: Record<string, string> = {};
for (const [company, accounts] of Object.entries(COMPANY_ACCOUNTS)) {
  for (const a of accounts) _BY_ACCOUNT[canonAccount(a)] = company;
}

export function excludesCompanyFallback(channelType?: string | null): boolean {
  const normalized = (channelType ?? "").replace(/\s+/g, "");
  return normalized.includes("온드미디어") || normalized.includes("위성채널");
}

/** 계정명 → 업체명(매핑에 있으면), 없으면 null. 대소문자·구분기호 차이 무관(canonAccount). */
export function companyForAccount(name?: string | null, channelType?: string | null): string | null {
  if (excludesCompanyFallback(channelType)) return null;
  if (!name) return null;
  return _BY_ACCOUNT[canonAccount(name)] ?? null;
}

export type CompanyPollutionRepair = {
  companyName: string | null;
  polluted: boolean;
};

/** 업체명이 계정명의 표기 변형이면 오적재로 보고 회사 맵 정본(없으면 null)으로 교정한다. */
export function repairPollutedCompanyName(
  companyName?: string | null,
  accountName?: string | null,
  channelType?: string | null,
): CompanyPollutionRepair {
  const company = String(companyName ?? "").trim() || null;
  const companyKey = canonAccount(company);
  const accountKey = canonAccount(accountName);
  // 오염 판정: ① canon 계정명과 동일(대소문자·구분기호 변형 포함) 또는
  //   ② 순수 ascii 핸들꼴(^[a-z0-9._-]+$). 정식 업체명은 전부 한글/공백 포함(무디·톡톡컴퍼니·
  //   스튜디오 엔터·모두의행복 등)이라 ascii 핸들꼴 업체명은 항상 계정 핸들 오적재로 본다.
  //   (2026-08: '486'=486__humor 조각처럼 계정명과 canon이 달라 ①만으론 못 잡고 재유입되던 것을 ②로 차단)
  const looksHandle = company != null && /^[a-z0-9._-]+$/.test(company);
  const polluted = Boolean(company && ((companyKey && accountKey && companyKey === accountKey) || looksHandle));
  return {
    companyName: polluted ? companyForAccount(accountName, channelType) : company,
    polluted,
  };
}
