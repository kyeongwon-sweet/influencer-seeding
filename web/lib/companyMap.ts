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

const _BY_ACCOUNT: Record<string, string> = {};
for (const [company, accounts] of Object.entries(COMPANY_ACCOUNTS)) {
  for (const a of accounts) _BY_ACCOUNT[a.toLowerCase()] = company;
}

export function excludesCompanyFallback(channelType?: string | null): boolean {
  const normalized = (channelType ?? "").replace(/\s+/g, "");
  return normalized.includes("온드미디어") || normalized.includes("위성채널");
}

/** 계정명 → 업체명(매핑에 있으면), 없으면 null. 대소문자 무관. */
export function companyForAccount(name?: string | null, channelType?: string | null): string | null {
  if (excludesCompanyFallback(channelType)) return null;
  if (!name) return null;
  return _BY_ACCOUNT[name.trim().toLowerCase()] ?? null;
}
