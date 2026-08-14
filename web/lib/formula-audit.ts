// 연동시트 누적(H)·증분(I) 수식 전수감사 — 순수 로직 (매일 아침 크론이 라우트로 호출)
//
// 배경: 수식 파손은 조용히 발생한다(2026-07-27 열 삭제로 증분 #REF! 전멸, 2026-07-29 V2 반영
// 회귀로 증분열 일시 전멸 — 둘 다 사람이 늦게 발견). 매일 아침 dailyAuto의 수식 재기입 직후
// 시트 실물을 DB 재현값과 전수 대조해 Slack으로 보고하면, 파손이 하루 이상 방치되지 않는다.
//
// 판정 규칙(알림만, 수정 없음 — 무결성 절대규칙):
//  - 오류셀(#REF!/#N/A/#ERROR! 등): 즉시 이상.
//  - H(누적): 그 행 날짜열 양수 최대와 일치=정합 / 수식 아닌 수동값(≠MAX)=허용(V4 정책, 집계만)
//    / 날짜값이 있는데 H 빈칸=이상.
//  - I(증분): 두 기대값 중 하나와 일치하면 정합 —
//    ① 시트 자족 기대값(V2 의미): 마지막 양수 − 이전 양수 최대(0 하한), 1개면 전액
//    ② DB 규칙 기대값: DB 실측일 교집합 refs 기준 동일 계산, 백로그(게시 7일 초과 첫 측정)는 빈칸
//    (V2 전환기·당일 수기값 등 정상 편차를 오탐하지 않기 위한 이중 기준)

export type AuditPost = {
  posted: string | null;   // YYYY-MM-DD
  ended: string | null;    // YYYY-MM-DD
  channelType?: string | null;
  measured: Map<string, number>; // YYYY-MM-DD → 양수 지표(배너=reach 우선, 그 외 play)
};

// 값 정체(수집 끊김) 판정 기준: 자동수집은 '어제'까지 채우므로 2일 넘게 새 값이 없으면 이상.
export const STALE_DAYS = 2;

/** 조회수 지표가 매일 들어오지 않는 게 정상인 채널 — 정체 판정에서 제외. */
export function isMetriclessChannel(channelType: string | null | undefined): boolean {
  const ct = String(channelType ?? "");
  return /배너|피드|사진|이미지|위성채널|온드미디어/.test(ct);
}

function shiftDate(day: string, delta: number): string {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export type SheetAuditRow = {
  key: string;             // postIdentityKey
  label: string;           // 채널명 등 표시용
  sourceRow?: number;      // 연동시트 실제 행 번호(수술적 정정용)
  h: number | string | null;
  inc: number | string | null;
  // FORMULA 렌더로 읽은 원문. undefined면 형태 감사 미실행(순수로직 단위테스트/폴백 호환).
  // null·숫자·`=""`는 값이 우연히 맞더라도 잘못된 수식 형태로 판정한다.
  hFormula?: string | number | boolean | null;
  incFormula?: string | number | boolean | null;
  dates: Array<{ date: string; value: number }>; // 양수 날짜값(오름차순)
};

export type AuditResult = {
  totalRows: number;
  orphanRows: number;
  orphanNotes: string[];
  h: { ok: number; manualKept: number; emptyOk: number; valueOnly: number; errorCells: number; emptyButData: number };
  inc: { ok: number; emptyOk: number; errorCells: number; mismatch: number; blankExpected: number };
  formulaShape: { hInvalid: number; incInvalid: number };
  anomalies: string[];     // 사람이 읽을 요약 라인 (상한 있음)
  /**
   * 값 정체 — 수식은 멀쩡한데 **새 값이 안 들어오는** 행.
   *
   * ⚠️ 이 감사가 원래 못 보던 사각이다(2026-08-03 실측): 게시물이 삭제된 74건과 게시일 불일치로
   * 버려진 6건이 조회수가 며칠째 멈춰 있었는데, 시트끼리는 앞뒤가 맞아 나흘 내리 "이상 없음"으로
   * 보고됐다. 수식 정합만으로는 "값이 통째로 안 들어온다"를 절대 알 수 없다.
   */
  stale: number;
  staleNotes: string[];
};

const ANOMALY_CAP = 12;

// 날짜 헤더 파싱 — 시트에 3종이 혼재한다(운영 실측):
//   ① "5. 17 (일)"·"6.1" (월.일, 연도 없음 → 롤오버 추정)
//   ② "26.7.16.(목)" (2자리 연도 접두 — Codex가 .gs에 인식 추가한 형식. 기존 공용 parseMonthDay는
//      이걸 month=26으로 읽어 null을 반환했다 → 최신 날짜열이 조용히 무시되던 원인)
//   ③ 날짜 셀(직렬 숫자) 또는 "2026-07-16"
// 연도가 명시된 형식은 그 연도를 그대로 쓰고, 없으면 월 감소 시 +1년 롤오버로 추정한다.
export function parseHeaderDate(
  value: string | number | boolean | null,
  state: { year: number; prevMonth: number | null },
): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Google 직렬 날짜(1899-12-30 기준)
    const ms = Math.round((value - 25569) * 86400000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() < 2100) {
      state.prevMonth = d.getUTCMonth() + 1;
      state.year = d.getUTCFullYear();
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    return null;
  }
  const s = String(value).trim();
  if (!s) return null;

  const commit = (y: number, mo: number, da: number): string | null => {
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    state.year = y;
    state.prevMonth = mo;
    return `${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`;
  };

  // 4자리 연도
  let m = s.match(/^\s*(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (m) return commit(Number(m[1]), Number(m[2]), Number(m[3]));
  // 2자리 연도 접두 (26.7.16 / 26-7-16)
  m = s.match(/^\s*(\d{2})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (m) return commit(2000 + Number(m[1]), Number(m[2]), Number(m[3]));
  // 월.일 (연도 없음 → 롤오버 추정)
  m = s.match(/^\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
  if (m) {
    const mo = Number(m[1]);
    const da = Number(m[2]);
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    const year = state.prevMonth !== null && mo < state.prevMonth ? state.year + 1 : state.year;
    return commit(year, mo, da);
  }
  return null;
}

function isErrorCell(v: number | string | null): boolean {
  return typeof v === "string" && v.trim().startsWith("#");
}

function asNumber(v: number | string | null): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

// 마지막 양수 − 이전 양수 최대(0 하한). 1개면 전액. 없으면 null.
function lastMinusPrevMax(values: number[]): number | null {
  if (values.length === 0) return null;
  const last = values[values.length - 1];
  if (values.length === 1) return last;
  const prevMax = Math.max(...values.slice(0, -1));
  return Math.max(0, last - prevMax);
}

export function expectedCumulativeFormula(row: number): string {
  return `=IF(COUNT(P${row}:DH${row})=0,"",MAX(P${row}:DH${row}))`;
}

export function expectedIncrementFormula(row: number): string {
  return `=IFERROR(LET(rng,$P${row}:$DH${row},cols,SEQUENCE(1,COLUMNS(rng),COLUMN($P${row}),1),lastC,MAX(FILTER(cols,rng>0)),lastV,INDEX(rng,1,lastC-COLUMN($P${row})+1),prev,FILTER(rng,cols<lastC,rng>0),IFERROR(MAX(0,lastV-MAX(prev)),lastV)),"")`;
}

function sameFormula(actual: string | number | boolean | null, expected: string): boolean {
  if (typeof actual !== "string" || !actual.startsWith("=")) return false;
  const normalize = (value: string) => value.replace(/\s+/g, "").toUpperCase();
  return normalize(actual) === normalize(expected);
}

export function auditRows(
  rows: SheetAuditRow[],
  posts: Map<string, AuditPost>,
  todayKst: string,
  orphanNotes: string[] = [],
): AuditResult {
  const res: AuditResult = {
    totalRows: rows.length,
    orphanRows: orphanNotes.length,
    orphanNotes: orphanNotes.slice(0, ANOMALY_CAP),
    h: { ok: 0, manualKept: 0, emptyOk: 0, valueOnly: 0, errorCells: 0, emptyButData: 0 },
    inc: { ok: 0, emptyOk: 0, errorCells: 0, mismatch: 0, blankExpected: 0 },
    formulaShape: { hInvalid: 0, incInvalid: 0 },
    anomalies: [],
    stale: 0,
    staleNotes: [],
  };
  const note = (line: string) => { if (res.anomalies.length < ANOMALY_CAP) res.anomalies.push(line); };
  // 정체 노트는 별도 상한 — 수식 이상 노트를 밀어내지 않게 한다.
  const staleNote = (line: string) => { if (res.staleNotes.length < ANOMALY_CAP) res.staleNotes.push(line); };
  const staleCutoff = shiftDate(todayKst, -STALE_DAYS);

  for (const row of rows) {
    const positives = row.dates.map((d) => d.value);
    const rowMax = positives.length ? Math.max(...positives) : null;

    // 값이 맞는지와 수식이 살아 있는지는 별개다. 숫자 덮어쓰기와 `=""` 스텁은
    // 현재 표시값이 우연히 맞아도 다음 날짜 값부터 갱신이 멈추므로 즉시 경고한다.
    if (row.sourceRow && row.hFormula !== undefined && !sameFormula(row.hFormula, expectedCumulativeFormula(row.sourceRow))) {
      res.formulaShape.hInvalid += 1;
      note(`H수식형태 오류 ${row.label} (${row.key} · 행 ${row.sourceRow})`);
    }
    if (row.sourceRow && row.incFormula !== undefined && !sameFormula(row.incFormula, expectedIncrementFormula(row.sourceRow))) {
      res.formulaShape.incInvalid += 1;
      note(`I수식형태 오류 ${row.label} (${row.key} · 행 ${row.sourceRow})`);
    }

    // ── 값 정체(수집 끊김) ── 수식과 무관하게, '새 값이 들어오는지'를 본다.
    {
      const p0 = posts.get(row.key);
      const eligible = p0 && !p0.ended && p0.posted
        && p0.posted <= staleCutoff            // 갓 올린 글은 아직 값이 없는 게 정상
        && !isMetriclessChannel(p0.channelType); // 배너·피드·위성/온드는 매일 값이 없는 게 정상
      if (eligible) {
        // ⚠️ 반드시 **DB 실측**으로 판정한다. 시트 날짜칸은 exportStats가 '측정 없음' 빈칸을 직전
        //    누적값으로 이어받아 채우므로(표시 보정), 시트만 보면 수집이 끊겨도 연속처럼 보인다.
        //    (첫 구현이 시트 기준이라 실제 정체 3건을 0건으로 놓쳤다 — 2026-08-03 자체 검증에서 발견)
        const measuredDates = [...p0!.measured.keys()].sort();
        const lastMeasured = measuredDates.length ? measuredDates[measuredDates.length - 1] : null;
        if (!lastMeasured || lastMeasured < staleCutoff) {
          res.stale += 1;
          staleNote(`값정체 ${row.label} (${row.key}): 마지막 실측 ${lastMeasured ?? "없음"} (게시 ${p0!.posted})`);
        }
      }
    }

    // ── H(누적) ──
    if (isErrorCell(row.h)) {
      res.h.errorCells += 1;
      note(`H오류 ${row.label}: ${String(row.h).trim()}`);
    } else {
      const hNum = asNumber(row.h);
      if (rowMax == null && hNum == null) res.h.emptyOk += 1;
      else if (rowMax == null && hNum != null) res.h.valueOnly += 1;        // 종료글 최종값 보존 등(정상)
      else if (hNum == null) {
        res.h.emptyButData += 1;
        note(`H빈칸(데이터有) ${row.label}: max=${rowMax}`);
      } else if (hNum === rowMax) res.h.ok += 1;
      else res.h.manualKept += 1;                                           // V4 수동 보존(허용)
    }

    // ── I(증분) ──
    if (isErrorCell(row.inc)) {
      res.inc.errorCells += 1;
      note(`I오류 ${row.label}: ${String(row.inc).trim()}`);
      continue;
    }
    const got = asNumber(row.inc);
    const expSheet = lastMinusPrevMax(positives);

    let expDb: number | null | undefined = undefined; // undefined = DB 정보 없음(판정에서 제외)
    let firstMeasure = false;                         // 유효 실측이 딱 하나 = 게시물 첫 측정일
    const p = posts.get(row.key);
    if (p) {
      const refs = row.dates.filter((d) =>
        d.date < todayKst &&
        (p.measured.get(d.date) ?? 0) > 0 &&
        (!p.posted || d.date >= p.posted) &&
        (!p.ended || d.date <= p.ended));
      firstMeasure = refs.length === 1;
      if (refs.length === 0) expDb = null;
      else if (refs.length === 1 && p.posted &&
        (Date.parse(refs[0].date) - Date.parse(p.posted)) / 86400000 > 7) expDb = null; // 백로그
      else expDb = lastMinusPrevMax(refs.map((r) => r.value));
    }

    const matches = (exp: number | null | undefined) =>
      exp !== undefined && exp != null && got != null && got === exp;

    if (got == null) {
      // 빈칸이 정상인 경우: DB 규칙상 빈칸(백로그/유효 refs 없음) 또는 시트에도 계산할 값이 없음
      if (expDb === null || expSheet == null) { res.inc.emptyOk += 1; continue; }
      // 값이 있어야 하는데 증분 셀이 빈칸 — 대표 사례: 신규 게시물 첫 측정일에
      //  라이브 시트 증분 수식이 '첫 유효측정=그날 전체'를 자동표시 못 해 사람이 수기로 채우는 갭.
      //  전용 카운트로 분리해 매일 아침 감사에 노출한다(조용한 누락 방지, 2026-08-06).
      res.inc.blankExpected += 1;
      note(`증분빈칸(값있어야함${firstMeasure ? "·신규첫측정" : ""}) ${row.label}: 기대=${expDb ?? expSheet}`);
      continue;
    }
    if (matches(expSheet) || matches(expDb)) { res.inc.ok += 1; continue; }
    res.inc.mismatch += 1;
    const where = row.sourceRow ? ` (${row.key} · 행 ${row.sourceRow})` : ` (${row.key})`;
    note(`I불일치 ${row.label}${where}: 값=${got ?? "빈칸"} 기대(시트)=${expSheet ?? "빈칸"} 기대(DB)=${expDb === undefined ? "?" : expDb ?? "빈칸"}`);
  }
  return res;
}

export function formatAuditMessage(r: AuditResult): { text: string; healthy: boolean } {
  const problems = r.h.errorCells + r.h.emptyButData + r.inc.errorCells + r.inc.mismatch + r.inc.blankExpected
    + r.formulaShape.hInvalid + r.formulaShape.incInvalid + r.orphanRows;
  const staleTail = r.stale > 0
    ? `\n🟠 값 정체 ${r.stale}건 — 수식은 정상인데 새 값이 ${STALE_DAYS}일 넘게 안 들어옵니다(삭제·수집실패 의심)\n`
      + r.staleNotes.slice(0, 8).map((s) => "• " + s).join("\n")
      + (r.stale > 8 ? `\n• ...외 ${r.stale - 8}건` : "")
    : "";
  // ⚠️ '이상 없음'은 **수식 정합**에 한한 말이다. 값이 안 들어오는 건 별도로 반드시 붙인다
  //    (그렇지 않으면 74건이 멈춰 있어도 "이상 없음"으로 읽힌다 — 2026-08-03 실제 사고).
  const head = problems === 0
    ? `✅ [수식 전수감사] 수식 이상 없음 — 행 ${r.totalRows} · 수식형태 H ${r.formulaShape.hInvalid}/I ${r.formulaShape.incInvalid} · 누적 정합 ${r.h.ok}(수동보존 ${r.h.manualKept}·보존값 ${r.h.valueOnly}·빈칸정상 ${r.h.emptyOk}) · 증분 정합 ${r.inc.ok}(빈칸정상 ${r.inc.emptyOk})`
    : `🔴 [수식 전수감사] 이상 ${problems}건 — 고아행 ${r.orphanRows} / 수식형태 H ${r.formulaShape.hInvalid}·I ${r.formulaShape.incInvalid} / H 오류셀 ${r.h.errorCells}·데이터有빈칸 ${r.h.emptyButData} / I 오류셀 ${r.inc.errorCells}·불일치 ${r.inc.mismatch}·증분빈칸(값있어야함) ${r.inc.blankExpected} (행 ${r.totalRows}, 정합 H ${r.h.ok}·I ${r.inc.ok})`;
  const detail = [...r.orphanNotes, ...r.anomalies].slice(0, ANOMALY_CAP);
  const body = problems === 0 ? "" : "\n" + detail.map((a) => "• " + a).join("\n");
  return { text: head + body + staleTail, healthy: problems === 0 && r.stale === 0 };
}
