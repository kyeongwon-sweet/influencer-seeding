/**
 * 2026-09-01 연동시트 DS1 날짜 헤더 누락 수리.
 *
 * 증상: DR1=2026-08-31, DS1=blank인데 H/I 표준 수식은 DS까지 참조해
 * DB 대조 formula-audit가 sheet_snapshot_not_ready(503)로 fail-closed 했다.
 *
 * 안전 범위:
 * - 대상 탭 gid와 DR1 날짜, DS1 공백/정확한 표시값 9.1, H3/I3의 DS 참조를 모두 확인한다.
 * - DS1 한 셀만 실제 날짜 2026-09-01로 쓴다. 값 지어내기·H/I 재생성 없음.
 * - 실행 전 진단값을 숨김 백업 탭에 남긴다.
 */

var DS_HEADER_REPAIR_GID_ = 1937186871;
var DS_HEADER_REPAIR_PREV_A1_ = "DR1";
var DS_HEADER_REPAIR_TARGET_A1_ = "DS1";
var DS_HEADER_REPAIR_BACKUP_PREFIX_ = "_codex_ds1_header_backup_20260901";

function dsHeaderRepairDateText_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return "";
  return Utilities.formatDate(value, "Asia/Seoul", "yyyy-MM-dd");
}

function dsHeaderRepairSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === DS_HEADER_REPAIR_GID_) return sheets[i];
  }
  throw new Error("연동시트 gid=" + DS_HEADER_REPAIR_GID_ + "를 찾지 못했습니다.");
}

function dsHeaderRepairBackup_(sheet, before) {
  var ss = sheet.getParent();
  var name = DS_HEADER_REPAIR_BACKUP_PREFIX_;
  var suffix = 2;
  while (ss.getSheetByName(name)) name = DS_HEADER_REPAIR_BACKUP_PREFIX_ + "_" + suffix++;
  var backup = ss.insertSheet(name);
  backup.getRange("A1:B6").setValues([
    ["field", "value"],
    ["sheet", sheet.getName()],
    ["target", DS_HEADER_REPAIR_TARGET_A1_],
    ["before", before.targetDisplay],
    ["previous", before.previousDisplay],
    ["formula_samples", before.hFormula + " | " + before.iFormula]
  ]);
  backup.hideSheet();
  return name;
}

function repairMissingDateHeader20260901() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(5000)) throw new Error("다른 시트 작업이 실행 중입니다.");
  try {
    var sheet = dsHeaderRepairSheet_();
    var previous = sheet.getRange(DS_HEADER_REPAIR_PREV_A1_);
    var target = sheet.getRange(DS_HEADER_REPAIR_TARGET_A1_);
    var previousValue = previous.getValue();
    var targetValue = target.getValue();
    var before = {
      previousDisplay: previous.getDisplayValue(),
      targetDisplay: target.getDisplayValue(),
      hFormula: sheet.getRange("H3").getFormula(),
      iFormula: sheet.getRange("I3").getFormula()
    };

    if (dsHeaderRepairDateText_(previousValue) !== "2026-08-31") {
      throw new Error("DR1 guard 실패: " + before.previousDisplay);
    }
    if (dsHeaderRepairDateText_(targetValue) === "2026-09-01") {
      return { status: "ALREADY_DONE", target: DS_HEADER_REPAIR_TARGET_A1_, value: "2026-09-01" };
    }
    var targetIsBlank = targetValue === "" || targetValue == null;
    var targetDisplayCompact = before.targetDisplay.replace(/[\s\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "");
    var targetHasExpectedDisplay = /^9\.1\.?$/.test(targetDisplayCompact);
    if (!targetIsBlank && !targetHasExpectedDisplay) {
      throw new Error("DS1 guard 실패: 공백/표시값 9.1이 아닙니다. " + before.targetDisplay);
    }
    if (before.hFormula.indexOf("DS3") < 0 || before.iFormula.indexOf("DS3") < 0) {
      throw new Error("H3/I3 수식이 DS까지 참조하지 않아 쓰지 않습니다.");
    }

    var backupSheet = dsHeaderRepairBackup_(sheet, before);
    var targetDate = Utilities.parseDate("2026-09-01", "Asia/Seoul", "yyyy-MM-dd");
    previous.copyTo(target, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    target.setValue(targetDate).setNumberFormat("yy.m.d.(ddd)");
    SpreadsheetApp.flush();

    var after = target.getValue();
    if (dsHeaderRepairDateText_(after) !== "2026-09-01") {
      throw new Error("DS1 사후검증 실패: " + target.getDisplayValue());
    }
    var result = {
      status: "OK",
      target: DS_HEADER_REPAIR_TARGET_A1_,
      value: "2026-09-01",
      backupSheet: backupSheet
    };
    Logger.log("repair_missing_date_header_20260901 " + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
