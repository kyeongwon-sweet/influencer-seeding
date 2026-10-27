// 파인트 인지광고 대시보드 탭(마케팅T 시트, gid 55181281)에서 그날 인지광고·전환 조회수를 읽는다.
// 바치케(P바치) 일일 증분 리포트용(2026-10-27). /api/awareness-ads?tab=pint 가 이 함수를 쓴다.
//
// 탭 구조(쫀득바 탭과 다름):
//   '[일자별 현황]' 블록 — 섹션행: 인지영상_Meta / 인지영상_YouTube / 인지영상_TikTok (각 광고비·조회수·조회당비용)
//                         서브헤더행: 월(26.10) · 날짜(10.26) · … · 전환 조회수 · … · 광고비/조회수/조회당비용
//   위쪽 월별·주차별 블록은 같은 이름(인지영상)이 접미사 없이 쓰여 섹션행 탐지에 걸리지 않는다.
// ⚠️ 같은 탭의 PPL·매거진·먹스타·협찬·무상시딩 열은 DB가 따로 세는 채널이라 읽지 않는다(중복 합산 방지).
// ⚠️ 열번호 하드코딩 금지 — 헤더 라벨로 찾는다(쫀득바 탭이 열 이동으로 3번 깨진 이력).

export type Cell = string | number | null | undefined;
type Pair = { cost: number; view: number };
export type Channel = { views: number | null; cost: number | null };
export type PintDay =
  | { date: string; found: false; warn?: string[] }
  | {
      date: string;
      found: true;
      meta: Channel;
      tiktok: Channel;
      youtube: Channel;
      conversion: { views: number | null };
      warn?: string[];
    };

const norm = (v: Cell) => String(v ?? "").replace(/\s+/g, "");

// "10.26"(날짜)·"26.10"(월) 점 표기 → {a, b}. 숫자로 들어오면 소수 둘째 자리까지 펴서 읽는다(10.1 → "10.10").
// 같은 날짜로 두 행이 잡히면 warn(10.1/10.10 혼동 같은 입력 실수 감지).
function parseDot(v: Cell): { a: number; b: number } | null {
  const s = typeof v === "number" ? v.toFixed(2) : String(v ?? "").trim();
  const m = s.match(/^(\d{1,2})\s*\.\s*(\d{1,2})$/);
  return m ? { a: parseInt(m[1], 10), b: parseInt(m[2], 10) } : null;
}

function numOrNull(v: Cell): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s₩%]/g, ""));
  return isFinite(n) ? n : null;
}

type PintColMap = { month: number; date: number; conversionView: number; meta: Pair; yt: Pair; tt: Pair; startRow: number };

function detectPintColumns(rows: Cell[][]): PintColMap | null {
  const secRow = rows.findIndex((r) => r.some((c) => norm(c) === "인지영상_Meta"));
  if (secRow < 0) return null;
  const sec = rows[secRow];
  const sub = rows[secRow + 1] || [];
  const pair = (label: string): Pair | null => {
    const c = sec.findIndex((v) => norm(v) === label);
    if (c < 0 || norm(sub[c]) !== "광고비" || norm(sub[c + 1]) !== "조회수") return null;
    return { cost: c, view: c + 1 };
  };
  const meta = pair("인지영상_Meta");
  const yt = pair("인지영상_YouTube");
  const tt = pair("인지영상_TikTok");
  if (!meta || !yt || !tt) return null;
  const at = (labels: string[]) => sub.findIndex((v) => labels.includes(norm(v)));
  const date = at(["날짜"]);
  if (date < 0) return null;
  return { month: at(["월"]), date, conversionView: at(["전환조회수", "전환노출수"]), meta, yt, tt, startRow: secRow + 2 };
}

/** date = 'YYYY-MM-DD'. 행이 없으면 found:false, 헤더 탐지 실패면 found:false + warn(발송 전 검수가 차단). */
export function readPintDay(rows: Cell[][], date: string): PintDay {
  const [yy, mo, dy] = date.split("-").map((s) => parseInt(s, 10));
  const COL = detectPintColumns(rows);
  if (!COL) {
    return {
      date,
      found: false,
      warn: ["파인트 인지광고 열 자동탐지 실패 — 시트 헤더([일자별 현황] 인지영상_Meta/YouTube/TikTok·광고비/조회수·날짜·전환 조회수) 확인 필요"],
    };
  }
  const warns: string[] = [];
  let target: Cell[] | null = null;
  let hits = 0;
  for (let i = COL.startRow; i < rows.length; i++) {
    const r = rows[i];
    const md = parseDot(r[COL.date]);
    if (!md || md.a !== mo || md.b !== dy) continue;
    if (COL.month >= 0) {
      const ym = parseDot(r[COL.month]); // "26.10" = 2026년 10월(다음 해 같은 날짜 행과 구분)
      if (ym && (ym.a !== yy % 100 || ym.b !== mo)) continue;
    }
    target = r;
    hits++;
  }
  if (!target) return { date, found: false };
  if (hits > 1) warns.push(`파인트 탭에 ${date} 행이 ${hits}개 — 날짜 칸 입력 확인 필요(마지막 행 사용)`);

  const row = target;
  const ch = (p: Pair, label: string): Channel => {
    // 조회수 칸에 ₩(광고비)가 잡히면 열이 밀린 것 → 값 대신 warn(발송 전 검수가 차단).
    const raw = row[p.view];
    if (typeof raw === "string" && raw.includes("₩")) {
      warns.push(`${label} 조회수 칸(열 ${p.view})에 ₩값 감지 — 시트 열 정렬 확인 필요(광고비 오독 방지)`);
      return { views: null, cost: numOrNull(row[p.cost]) };
    }
    return { views: numOrNull(raw), cost: numOrNull(row[p.cost]) };
  };
  return {
    date,
    found: true,
    meta: ch(COL.meta, "메타"),
    tiktok: ch(COL.tt, "틱톡"),
    youtube: ch(COL.yt, "유튜브"),
    // 빈칸은 null(→ 리포트 '미입력'), "0"은 0. 헤더 못 찾으면 null.
    conversion: { views: COL.conversionView >= 0 ? numOrNull(row[COL.conversionView]) : null },
    ...(warns.length ? { warn: warns } : {}),
  };
}
