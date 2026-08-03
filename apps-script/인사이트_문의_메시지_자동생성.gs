/**
 * 라라스윗 — 바이럴 배너 인사이트 문의 메시지 자동 생성
 *
 * 첨부 원본 `인사이트_문의_메시지_자동생성.gs`를 공유 Apps Script에 맞게 이식했다.
 * - 기존 프로젝트 전역 함수와 충돌하지 않도록 모든 이름을 insightInquiry*로 분리한다.
 * - 열 문자가 바뀌어도 동작하도록 헤더 이름으로 업로드일/URL/채널분류/업체명을 찾는다.
 * - onOpen()은 Combined_Sheet_AppsScript.gs 한 곳만 유지하고 addInsightInquiryMenu_()를 호출한다.
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
    + "아래 게시물 현재까지 누적 조회수 부탁드려요.",
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
      ["총행수", "날짜없음", "URL없음", "업체명없음", "채널분류_불일치", "날짜창_밖", "대상"]
        .forEach(function (key) { report.push("  " + key + ": " + (stats[key] || 0)); });
      report.push("  → 업체 " + groups.length + "곳");
    }
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
  ["총행수", "날짜없음", "URL없음", "업체명없음", "채널분류_불일치", "날짜창_밖", "대상"]
    .forEach(function (key) { tally[key] = tally[key] || 0; });
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

    const dayNumber = targetDay - insightInquiryDayNumber_(uploadDate);
    if (dayNumber < 1 || dayNumber > INSIGHT_INQUIRY_CONFIG.WINDOW_DAYS) {
      tally["날짜창_밖"]++;
      return;
    }
    tally["대상"]++;
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

function insightInquiryNormalizeHeader_(value) {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function insightInquiryDayNumber_(dateValue) {
  return Math.floor(Date.UTC(dateValue.getFullYear(), dateValue.getMonth(), dateValue.getDate()) / 86400000);
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
