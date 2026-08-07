/**
 * 라라스윗 — 바이럴 배너 인사이트 문의 메시지 자동 생성
 *
 * - 기존 프로젝트 전역 함수와 충돌하지 않도록 모든 이름을 insightInquiry*로 분리한다.
 * - 열 문자가 바뀌어도 동작하도록 헤더 이름으로 업로드일/URL/채널분류/업체명을 찾는다.
 * - onOpen()은 Combined_Sheet_AppsScript.gs 한 곳만 유지하고 addInsightInquiryMenu_()를 호출한다.
 *
 * 문의 규칙 (영업일 = 월~금에만 문의)
 *   · 대상: 채널분류가 '바이럴(배너)'인 게시물만
 *   · 기본: 업로드 다음날(D+1)부터 D+7까지, 그 중 평일에만 → 업로드 요일과 무관하게 5회
 *   · 예외: 매일 문의가 어려운 업체는 CONFIG.VENDOR_RULES에 따로 규칙을 둔다
 *   · 토·일 아침에는 메시지를 만들지 않는다
 */

const INSIGHT_INQUIRY_CONFIG = Object.freeze({
  SOURCE_SHEET: "콘텐츠 대시보드 연동",
  OUTPUT_SHEET: "오늘의문의",
  DIAGNOSTIC_SHEET: "문의_진단",
  HEADER_ROW: 1,
  CHANNEL_ONLY: "바이럴(배너)",
  WINDOW_DAYS: 7,
  TRIGGER_HOUR: 8,
  MESSAGE_INTRO: "안녕하세요! 오늘도 인사이트 요청드립니다 🙏\n"
    + "아래 게시물 현재까지 누적 조회수/도달수 부탁드려요.",

  /**
   * 매일 문의가 어려운 업체의 예외 규칙. 여기 없는 업체는 기본 규칙(D+1~D+7 평일)을 따른다.
   * 업체명은 시트의 업체명 값과 같아야 한다. (공백 차이는 무시하지만 글자는 같아야 함)
   *   weekly  : 월~목 업로드 → 그 주 금요일 / 금·토·일 업로드 → 그 직후 월요일. 게시물당 1회.
   *   offsets : 지정한 D+n에만 문의. 주말에 걸리면 다음 평일로 미루고, 같은 날로 겹치면 1회.
   */
  VENDOR_RULES: {
    "루나앤코코": { type: "weekly" },
    "굿띵투유": { type: "offsets", offsets: [1, 2, 7] },
  },
});

function addInsightInquiryMenu_() {
  SpreadsheetApp.getUi()
    .createMenu("📮 인사이트문의")
    .addItem("오늘 문의 메시지 만들기", "insightInquiryBuildToday")
    .addItem("날짜 직접 지정해서 만들기", "insightInquiryBuildForDate")
    .addSeparator()
    .addItem("🔍 진단 (내용이 안 나올 때)", "insightInquiryDiagnose")
    .addSeparator()
    .addItem("매일 오전 자동생성 켜기", "insightInquiryEnableDailyTrigger")
    .addItem("자동생성 끄기", "insightInquiryDisableDailyTrigger")
    .addToUi();
}

function insightInquiryBuildToday() {
  insightInquiryBuild_(new Date());
}

function insightInquiryBuildForDate() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "날짜 직접 지정",
    "기준 날짜를 입력하세요. (예: 2026-08-03)",
    ui.ButtonSet.OK_CANCEL,
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  const targetDate = insightInquiryParseDate_(response.getResponseText().trim());
  if (!targetDate) {
    ui.alert("날짜를 알아볼 수 없습니다. 2026-08-03 형식으로 입력해 주세요.");
    return;
  }
  insightInquiryBuild_(targetDate);
  ui.alert(
    insightInquiryFormatDate_(targetDate)
      + " 기준으로 「" + INSIGHT_INQUIRY_CONFIG.OUTPUT_SHEET + "」 탭을 만들었습니다.",
  );
}

function insightInquiryDiagnose() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = ss.getSheetByName(INSIGHT_INQUIRY_CONFIG.SOURCE_SHEET);
  const report = [];

  report.push("■ 설정값");
  report.push("SOURCE_SHEET = 「" + INSIGHT_INQUIRY_CONFIG.SOURCE_SHEET + "」");
  report.push("CHANNEL_ONLY = 「" + INSIGHT_INQUIRY_CONFIG.CHANNEL_ONLY + "」");
  report.push("스프레드시트 시간대: " + ss.getSpreadsheetTimeZone()
    + " / 스크립트 시간대: " + Session.getScriptTimeZone());
  report.push("");

  report.push("■ 이 파일의 탭 목록");
  ss.getSheets().forEach(function (sheet, index) {
    report.push((index + 1) + ". 「" + sheet.getName() + "」 마지막행=" + sheet.getLastRow()
      + " 마지막열=" + sheet.getLastColumn() + (sheet.isSheetHidden() ? " [숨김]" : ""));
  });
  report.push("");

  if (!source) {
    report.push("✗ 원본 탭을 찾을 수 없습니다.");
    insightInquiryWriteReport_(ss, report);
    return;
  }

  const columns = insightInquiryResolveColumns_(source, false);
  report.push("■ 헤더 매칭");
  ["date", "url", "channelType", "vendor"].forEach(function (key) {
    report.push("  " + key + " = " + (columns[key] ? insightInquiryColLetter_(columns[key]) : "찾지 못함"));
  });
  report.push("");

  const lastRow = source.getLastRow();
  const width = source.getLastColumn();
  report.push("■ 데이터 샘플 (머리글 다음 5행)");
  if (lastRow <= INSIGHT_INQUIRY_CONFIG.HEADER_ROW) {
    report.push("  데이터 행이 없습니다.");
  } else if (columns.missing.length) {
    report.push("  필수 헤더가 없어 샘플을 읽지 않았습니다: " + columns.missing.join(", "));
  } else {
    const sampleCount = Math.min(5, lastRow - INSIGHT_INQUIRY_CONFIG.HEADER_ROW);
    source.getRange(INSIGHT_INQUIRY_CONFIG.HEADER_ROW + 1, 1, sampleCount, width)
      .getValues()
      .forEach(function (row, index) {
        const uploadDate = insightInquiryParseDate_(row[columns.date - 1]);
        report.push("  " + (INSIGHT_INQUIRY_CONFIG.HEADER_ROW + 1 + index) + "행: 업로드일=["
          + row[columns.date - 1] + "]" + (uploadDate ? " → 날짜인식 O" : " → 날짜인식 실패 X")
          + " | 채널분류=[" + row[columns.channelType - 1] + "]"
          + " | 업체명=[" + row[columns.vendor - 1] + "]"
          + " | URL=[" + String(row[columns.url - 1] || "").slice(0, 45) + "]");
      });
  }
  report.push("");

  if (!columns.missing.length) {
    const stats = {};
    const groups = insightInquiryCollectGroups_(source, new Date(), stats, columns);
    report.push("■ 오늘(" + insightInquiryFormatDate_(new Date()) + ") 기준 집계");
    if (groups === null) {
      report.push("  오늘은 주말이라 문의 대상을 계산하지 않습니다.");
    } else {
      insightInquiryTallyKeys_()
        .forEach(function (key) { report.push("  " + key + ": " + (stats[key] || 0)); });
      report.push("  → 업체 " + groups.length + "곳");
    }
    report.push("");

    // 업체명이 어긋나면 조용히 기본(매일) 규칙으로 처리되므로 여기서 반드시 드러나게 한다.
    report.push("■ 업체별 예외 규칙");
    const sheetVendors = insightInquiryListVendors_(source, columns);
    Object.keys(INSIGHT_INQUIRY_CONFIG.VENDOR_RULES).forEach(function (name) {
      const found = sheetVendors.some(function (vendor) {
        return insightInquirySquash_(vendor) === insightInquirySquash_(name);
      });
      report.push("  " + (found ? "○" : "✗ 시트에 없는 이름!") + " 「" + name + "」 → "
        + insightInquiryDescribeRule_(INSIGHT_INQUIRY_CONFIG.VENDOR_RULES[name]));
    });
    report.push("  (기본 규칙 적용 업체: " + sheetVendors.filter(function (vendor) {
      return !insightInquiryGetVendorRule_(vendor);
    }).join(", ") + ")");
    report.push("  ※ ✗가 있으면 그 업체는 매일 문의로 처리됩니다. VENDOR_RULES의 업체명을 시트와 맞추세요.");
  }

  insightInquiryWriteReport_(ss, report);
  SpreadsheetApp.getUi().alert("「" + INSIGHT_INQUIRY_CONFIG.DIAGNOSTIC_SHEET
    + "」 탭에 진단 결과를 적었습니다.");
}

function insightInquiryBuild_(targetDate) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const source = insightInquiryGetSourceSheet_(ss);
  const columns = insightInquiryResolveColumns_(source, true);
  const groups = insightInquiryCollectGroups_(source, targetDate, null, columns);
  insightInquiryWriteOutput_(ss, targetDate, groups);
}

function insightInquiryGetSourceSheet_(ss) {
  const source = ss.getSheetByName(INSIGHT_INQUIRY_CONFIG.SOURCE_SHEET);
  if (!source) {
    const names = ss.getSheets().map(function (sheet) { return "「" + sheet.getName() + "」"; }).join(", ");
    throw new Error("「" + INSIGHT_INQUIRY_CONFIG.SOURCE_SHEET
      + "」 탭을 찾을 수 없습니다. 현재 탭: " + names);
  }
  return source;
}

function insightInquiryResolveColumns_(sheet, throwOnMissing) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const header = sheet.getRange(INSIGHT_INQUIRY_CONFIG.HEADER_ROW, 1, 1, lastColumn).getValues()[0];
  const normalized = header.map(insightInquiryNormalizeHeader_);
  const find = function (aliases) {
    for (let i = 0; i < aliases.length; i++) {
      const index = normalized.indexOf(insightInquiryNormalizeHeader_(aliases[i]));
      if (index >= 0) return index + 1;
    }
    return 0;
  };
  const columns = {
    date: find(["업로드일", "게시일"]),
    url: find(["게시물URL", "게시물 URL", "URL"]),
    channelType: find(["채널분류", "채널 분류"]),
    vendor: find(["업체명", "업체 명"]),
  };
  columns.missing = [];
  if (!columns.date) columns.missing.push("업로드일");
  if (!columns.url) columns.missing.push("게시물URL");
  if (!columns.channelType) columns.missing.push("채널분류");
  if (!columns.vendor) columns.missing.push("업체명");
  if (throwOnMissing && columns.missing.length) {
    throw new Error("필수 헤더를 찾을 수 없습니다: " + columns.missing.join(", "));
  }
  return columns;
}

function insightInquiryCollectGroups_(source, targetDate, stats, columns) {
  const dayOfWeek = targetDate.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return null;

  const lastRow = source.getLastRow();
  if (lastRow <= INSIGHT_INQUIRY_CONFIG.HEADER_ROW) return [];
  const values = source.getRange(
    INSIGHT_INQUIRY_CONFIG.HEADER_ROW + 1,
    1,
    lastRow - INSIGHT_INQUIRY_CONFIG.HEADER_ROW,
    source.getLastColumn(),
  ).getValues();
  const targetDay = insightInquiryDayNumber_(targetDate);
  const byVendor = {};
  const tally = stats || {};
  insightInquiryTallyKeys_().forEach(function (key) { tally[key] = tally[key] || 0; });
  tally["총행수"] = values.length;

  values.forEach(function (row) {
    const uploadDate = insightInquiryParseDate_(row[columns.date - 1]);
    const url = String(row[columns.url - 1] || "").trim();
    const vendor = String(row[columns.vendor - 1] || "").trim();
    const channelType = row[columns.channelType - 1];
    if (!uploadDate) { tally["날짜없음"]++; return; }
    if (!url) { tally["URL없음"]++; return; }
    if (!vendor) { tally["업체명없음"]++; return; }
    if (INSIGHT_INQUIRY_CONFIG.CHANNEL_ONLY
        && insightInquirySquash_(channelType) !== insightInquirySquash_(INSIGHT_INQUIRY_CONFIG.CHANNEL_ONLY)) {
      tally["채널분류_불일치"]++;
      return;
    }

    // 오늘이 이 게시물의 문의일인지 (업체별 예외 규칙 우선, 없으면 기본 D+1~D+7)
    if (!insightInquiryIsDueToday_(vendor, uploadDate, targetDate)) {
      tally["오늘_문의일_아님"]++;
      return;
    }
    tally["대상"]++;
    const dayNumber = targetDay - insightInquiryDayNumber_(uploadDate);
    if (!byVendor[vendor]) byVendor[vendor] = [];
    byVendor[vendor].push({ url: url, uploadDate: uploadDate, dayNumber: dayNumber });
  });

  return Object.keys(byVendor).sort().map(function (vendor) {
    return {
      vendor: vendor,
      items: byVendor[vendor].sort(function (a, b) { return a.uploadDate - b.uploadDate; }),
    };
  });
}

function insightInquiryTallyKeys_() {
  return ["총행수", "날짜없음", "URL없음", "업체명없음", "채널분류_불일치", "오늘_문의일_아님", "대상"];
}

// ── 문의일 판정 ─────────────────────────────────────────────────────────────

/** 업체명에 걸린 예외 규칙을 찾는다 (없으면 null) */
function insightInquiryGetVendorRule_(vendor) {
  const rules = INSIGHT_INQUIRY_CONFIG.VENDOR_RULES;
  const key = insightInquirySquash_(vendor);
  for (const name in rules) {
    if (insightInquirySquash_(name) === key) return rules[name];
  }
  return null;
}

/** 오늘이 이 게시물을 문의할 날인가 (호출부에서 오늘이 평일임은 이미 확인됨) */
function insightInquiryIsDueToday_(vendor, uploadDate, targetDate) {
  const rule = insightInquiryGetVendorRule_(vendor);
  const targetDay = insightInquiryDayNumber_(targetDate);

  if (rule && rule.type === "weekly") {
    return targetDay === insightInquiryDayNumber_(insightInquiryWeeklyTarget_(uploadDate));
  }
  if (rule && rule.type === "offsets") {
    return rule.offsets.some(function (offset) {
      const due = insightInquiryNextWeekday_(insightInquiryAddDays_(uploadDate, offset));
      return targetDay === insightInquiryDayNumber_(due);
    });
  }
  const dayNumber = targetDay - insightInquiryDayNumber_(uploadDate);
  return dayNumber >= 1 && dayNumber <= INSIGHT_INQUIRY_CONFIG.WINDOW_DAYS;
}

/** weekly 규칙의 문의일: 월~목 업로드는 그 주 금요일, 금·토·일 업로드는 그 직후 월요일 */
function insightInquiryWeeklyTarget_(uploadDate) {
  const dayOfWeek = uploadDate.getDay();
  const add = (dayOfWeek >= 1 && dayOfWeek <= 4) ? 5 - dayOfWeek
    : (dayOfWeek === 5) ? 3
      : (dayOfWeek === 6) ? 2
        : 1;
  return insightInquiryAddDays_(uploadDate, add);
}

/** 규칙 설명 문구 (진단 출력용) */
function insightInquiryDescribeRule_(rule) {
  if (rule.type === "weekly") return "월~목→그주 금요일 / 금·토·일→다음 월요일 (게시물당 1회)";
  if (rule.type === "offsets") return "D+" + rule.offsets.join(" · D+") + " (주말은 다음 평일)";
  return rule.type;
}

/** 시트에 실제로 있는 업체명 목록 (중복 제거) */
function insightInquiryListVendors_(source, columns) {
  const lastRow = source.getLastRow();
  if (lastRow <= INSIGHT_INQUIRY_CONFIG.HEADER_ROW || !columns.vendor) return [];
  const seen = {};
  source.getRange(INSIGHT_INQUIRY_CONFIG.HEADER_ROW + 1, columns.vendor,
    lastRow - INSIGHT_INQUIRY_CONFIG.HEADER_ROW, 1)
    .getValues()
    .forEach(function (row) {
      const vendor = String(row[0] || "").trim();
      if (vendor) seen[vendor] = true;
    });
  return Object.keys(seen).sort();
}

// ── 출력 ────────────────────────────────────────────────────────────────────

function insightInquiryWriteOutput_(ss, targetDate, groups) {
  let output = ss.getSheetByName(INSIGHT_INQUIRY_CONFIG.OUTPUT_SHEET);
  if (!output) output = ss.insertSheet(INSIGHT_INQUIRY_CONFIG.OUTPUT_SHEET, ss.getNumSheets());
  output.clear();

  const stamp = insightInquiryFormatDate_(targetDate)
    + " (" + "일월화수목금토".charAt(targetDate.getDay()) + ") 기준"
    + (INSIGHT_INQUIRY_CONFIG.CHANNEL_ONLY ? " · " + INSIGHT_INQUIRY_CONFIG.CHANNEL_ONLY + "만" : "");
  if (groups === null) {
    output.getRange(1, 1).setValue(stamp + " — 주말에는 문의하지 않습니다.");
    insightInquiryFinishOutput_(output, 0);
    return;
  }
  if (groups.length === 0) {
    output.getRange(1, 1).setValue(stamp + " — 오늘 문의할 게시물이 없습니다.");
    insightInquiryFinishOutput_(output, 0);
    return;
  }

  const total = groups.reduce(function (sum, group) { return sum + group.items.length; }, 0);
  const rows = [
    [stamp + " · 업체 " + groups.length + "곳 / 게시물 " + total + "건", "", ""],
    ["업체명", "건수", "C열 셀을 복사해서 단톡방에 붙여넣으세요"],
  ];
  groups.forEach(function (group) {
    rows.push([group.vendor, group.items.length, insightInquiryMakeMessage_(group.items)]);
  });
  output.getRange(1, 1, rows.length, 3).setValues(rows);
  insightInquiryFinishOutput_(output, groups.length);
}

function insightInquiryMakeMessage_(items) {
  const lines = items.map(function (item, index) {
    return (index + 1) + ". " + item.url + "\n   ("
      + insightInquiryFormatShortDate_(item.uploadDate) + " 업로드, D+" + item.dayNumber + ")";
  });
  return INSIGHT_INQUIRY_CONFIG.MESSAGE_INTRO + "\n\n" + lines.join("\n");
}

function insightInquiryFinishOutput_(output, groupCount) {
  output.setFrozenRows(groupCount ? 2 : 1);
  output.getRange(1, 1).setFontWeight("bold");
  if (groupCount) {
    output.getRange(2, 1, 1, 3).setFontWeight("bold").setBackground("#efefef");
    output.getRange(3, 3, groupCount, 1).setWrap(true).setVerticalAlignment("top");
  }
  output.setColumnWidth(1, 120);
  output.setColumnWidth(2, 50);
  output.setColumnWidth(3, 620);
}

function insightInquiryWriteReport_(ss, lines) {
  let sheet = ss.getSheetByName(INSIGHT_INQUIRY_CONFIG.DIAGNOSTIC_SHEET);
  if (!sheet) sheet = ss.insertSheet(INSIGHT_INQUIRY_CONFIG.DIAGNOSTIC_SHEET, ss.getNumSheets());
  sheet.clear();
  sheet.getRange(1, 1, lines.length, 1).setValues(lines.map(function (line) { return [line]; }));
  sheet.setColumnWidth(1, 900);
  ss.setActiveSheet(sheet);
}

// ── 트리거 ──────────────────────────────────────────────────────────────────

function insightInquiryEnableDailyTrigger() {
  insightInquiryDisableDailyTrigger_(false);
  ScriptApp.newTrigger("insightInquiryBuildToday")
    .timeBased()
    .atHour(INSIGHT_INQUIRY_CONFIG.TRIGGER_HOUR)
    .everyDays(1)
    .create();
  SpreadsheetApp.getUi().alert("매일 오전 " + INSIGHT_INQUIRY_CONFIG.TRIGGER_HOUR
    + "시경에 「" + INSIGHT_INQUIRY_CONFIG.OUTPUT_SHEET + "」 탭이 자동으로 갱신됩니다.");
}

function insightInquiryDisableDailyTrigger() {
  insightInquiryDisableDailyTrigger_(true);
}

function insightInquiryDisableDailyTrigger_(showAlert) {
  let removed = 0;
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (["insightInquiryBuildToday", "buildTodayMessages"].indexOf(trigger.getHandlerFunction()) >= 0) {
      ScriptApp.deleteTrigger(trigger);
      removed++;
    }
  });
  if (showAlert) SpreadsheetApp.getUi().alert("인사이트 문의 자동생성 트리거 " + removed + "개를 제거했습니다.");
}

// ── 도우미 ──────────────────────────────────────────────────────────────────

function insightInquiryNormalizeHeader_(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function insightInquiryDayNumber_(dateValue) {
  return Math.floor(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()) / 86400000);
}

function insightInquiryAddDays_(dateValue, days) {
  return new Date(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate() + days);
}

/** 주말이면 다음 평일(월요일)로 미룬 날짜 */
function insightInquiryNextWeekday_(dateValue) {
  const dayOfWeek = dateValue.getDay();
  if (dayOfWeek === 6) return insightInquiryAddDays_(dateValue, 2);
  if (dayOfWeek === 0) return insightInquiryAddDays_(dateValue, 1);
  return dateValue;
}

function insightInquirySquash_(value) {
  return String(value || "").replace(/\s/g, "");
}

function insightInquiryParseDate_(value) {
  if (value instanceof Date && !isNaN(value)) return value;
  const text = String(value || "").trim();
  if (!text) return null;
  const match = text.match(/(\d{4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const parsed = new Date(text);
  return isNaN(parsed) ? null : parsed;
}

function insightInquiryColLetter_(column) {
  let result = "";
  let value = column;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = (value - 1 - remainder) / 26;
  }
  return result;
}

function insightInquiryFormatDate_(dateValue) {
  return dateValue.getFullYear() + ". " + (dateValue.getMonth() + 1) + ". " + dateValue.getDate();
}

function insightInquiryFormatShortDate_(dateValue) {
  return (dateValue.getMonth() + 1) + "/" + dateValue.getDate();
}

// 기존 첨부본으로 만들어진 설치형 onOpen/시간 트리거가 남아 있어도 오류가 나지 않도록
// 공개 함수명만 호환한다. 내부 범용 함수명(parseDate_, colLetter_ 등)은 복원하지 않는다.
function addInsightMenu() { addInsightInquiryMenu_(); }
function buildTodayMessages() { insightInquiryBuildToday(); }
function buildMessagesForDate() { insightInquiryBuildForDate(); }
function diagnose() { insightInquiryDiagnose(); }
function enableDailyTrigger() { insightInquiryEnableDailyTrigger(); }
function disableDailyTrigger() { insightInquiryDisableDailyTrigger(); }
function installMenuTrigger() { addInsightInquiryMenu_(); }
