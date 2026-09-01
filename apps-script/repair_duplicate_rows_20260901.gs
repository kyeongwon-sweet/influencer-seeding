/**
 * 2026-09-01 연동시트 중복 URL 6그룹 수술적 정리.
 *
 * auditLinkedSheetDuplicates20260901()로 DB 정본 메타데이터·일별 이력까지 대조해
 * 정본과 다른 행만 명시했다. 일반화된 "채워진 셀이 적은 행 삭제" 규칙을 쓰지 않는다.
 */

var LINKED_DUPLICATE_REPAIR_BACKUP_PREFIX_ = "_codex_duplicate_backup_20260901_";
var LINKED_DUPLICATE_REPAIR_TARGETS_ = [
  {
    key: "tt:7678321378143128839",
    removeAsset: "[26.08]F_I_JD멜_인지_상시__바이럴형_에스파.마T기획_.배너_에스파.반전캐릭터성.대식가.먹짱에스파.__김바다_260821_빙과_오혜정",
    keepAsset: "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_선망성_main.렉카_카리나.인성.카리나가 사랑받을 자격이 있는 이유.디자인1.X_스틱바P_이세진_260826_빙과_최재헌"
  },
  {
    key: "tt:7678322050653637906",
    removeAsset: "[26.08]F_I_JD멜_인지_상시__바이럴형_에스파.마T기획_.배너_에스파.반전캐릭터성.대식가.에스파는음식에굉장히진심인편.__김바다_260821_빙과_오혜정",
    keepAsset: "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_선망성_var1.렉카_카리나.인성.카리나가 왜이리 무리해.디자인1.X_스틱바P_이세진_260826_빙과_최재헌"
  },
  {
    key: "yt:qtXOEzg4wX4",
    removeAsset: "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_선망성_var2.렉카_지젤.비주얼.여러모로 재능통 오는 지젤의 뮤비 비하인드.디자인1.X_스틱바P_이세진_260825_빙과_최재헌",
    keepAsset: "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_선망성_var2.렉카_카리나.인성.냉부 나와서 제대로 무리하고 간 카리나.디자인1.X_스틱바P_이세진_260826_빙과_최재헌"
  },
  {
    key: "yt:3--FZ4_o6IE",
    removeAsset: "[25.07]F_V_CO바_바이럴_상시_바이럴형_미미바이럴_var5.릴스_미미.밥굶2._2507KR0_최진환_250701_1T_이신규",
    keepAsset: "[25.07]F_V_BA혼_바이럴_상시_바이럴형_예능인캐릭터1_main.릴스_유명인.강민경.검은배경._2507KR0_이선민_250710_2T_배가람"
  },
  {
    key: "ig:DcBZOaEpDyt",
    removeUrl: "https://www.instagram.com/reel/DcBZOaEpDyt/",
    keepUrl: "https://www.instagram.com/p/DcBZOaEpDyt/",
    keepAsset: "[26.08]F_V_JD멜_바이럴_쫀득바출시_바이럴형_초딩유행템_var4.렉카_포켓몬.현시각 학부모 지갑 거덜내는 공포의 이것 근황.디자인1.X_파인트P_김유진_260814_빙과_김도희"
  },
  {
    key: "ig:DcpmS6LEVSc",
    removeAsset: "[26.08]F_I_JD복_인지_상시__바이럴형_콘T기획.배너_제품특장점.현시각스레드반응폭발했다는전설의베이킹._김바다_260828_빙과_오혜정",
    keepAsset: "[26.08]F_I_JD복_인지_상시__바이럴형_콘T기획.배너_다이소.다이소에숨은ㅁㅊ넘드뎌찾음._김바다_260828_빙과_오혜정"
  }
];

function linkedDuplicateRepairPlan20260901_() {
  var sheet = getSheet_();
  var fieldCols = buildFieldCols_(sheet);
  var lastRow = sheet.getLastRow();
  var values = sheet.getRange(CONFIG.DATA_START_ROW, 1, lastRow - CONFIG.DATA_START_ROW + 1, sheet.getLastColumn()).getValues();
  var rowsByKey = {};
  values.forEach(function (row, index) {
    var url = String(row[fieldCols.url - 1] || "").trim();
    var key = linkKey_(url);
    if (!key) return;
    (rowsByKey[key] = rowsByKey[key] || []).push({
      row: CONFIG.DATA_START_ROW + index,
      url: url,
      asset: String(row[fieldCols.asset_name - 1] || "")
    });
  });

  var removals = LINKED_DUPLICATE_REPAIR_TARGETS_.map(function (target) {
    var rows = rowsByKey[target.key] || [];
    if (rows.length !== 2) throw new Error(target.key + " 중복행 수가 2가 아님: " + rows.length);
    var removeMatches = rows.filter(function (row) {
      if (target.removeUrl) return row.url === target.removeUrl;
      return row.asset === target.removeAsset;
    });
    var keepMatches = rows.filter(function (row) {
      if (target.keepUrl) return row.url === target.keepUrl && row.asset === target.keepAsset;
      return row.asset === target.keepAsset;
    });
    if (removeMatches.length !== 1 || keepMatches.length !== 1) {
      throw new Error(target.key + " 정본/삭제행 식별 실패: " + JSON.stringify(rows));
    }
    return { key: target.key, remove: removeMatches[0], keep: keepMatches[0] };
  });

  return { sheet: sheet, lastRow: lastRow, removals: removals };
}

function auditDuplicateRepairPlan20260901() {
  var plan = linkedDuplicateRepairPlan20260901_();
  var result = {
    status: "DRY_RUN",
    lastRow: plan.lastRow,
    removeRows: plan.removals.map(function (item) { return item.remove.row; }),
    groups: plan.removals
  };
  Logger.log("linked_duplicate_repair_plan " + JSON.stringify(result));
  return result;
}

function repairDuplicateRows20260901() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var plan = linkedDuplicateRepairPlan20260901_();
    var ss = plan.sheet.getParent();
    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd_HHmmss");
    var backupName = LINKED_DUPLICATE_REPAIR_BACKUP_PREFIX_ + stamp;
    var backup = plan.sheet.copyTo(ss).setName(backupName);
    backup.hideSheet();

    var rows = plan.removals.map(function (item) { return item.remove.row; }).sort(function (a, b) { return b - a; });
    rows.forEach(function (row) { plan.sheet.deleteRow(row); });

    var afterLastRow = plan.sheet.getLastRow();
    var fieldCols = buildFieldCols_(plan.sheet);
    var urls = plan.sheet.getRange(CONFIG.DATA_START_ROW, fieldCols.url, afterLastRow - CONFIG.DATA_START_ROW + 1, 1).getValues();
    var counts = {};
    urls.forEach(function (row) {
      var key = linkKey_(String(row[0] || "").trim());
      if (key) counts[key] = (counts[key] || 0) + 1;
    });
    var remaining = Object.keys(counts).filter(function (key) { return counts[key] > 1; });
    if (remaining.length) throw new Error("삭제 후에도 중복 URL 잔존: " + remaining.join(", "));

    var result = {
      status: "OK",
      deletedRows: rows,
      deletedCount: rows.length,
      beforeLastRow: plan.lastRow,
      afterLastRow: afterLastRow,
      backupSheet: backupName,
      remainingDuplicates: 0
    };
    Logger.log("linked_duplicate_repair " + JSON.stringify(result));
    return result;
  } finally {
    lock.releaseLock();
  }
}
