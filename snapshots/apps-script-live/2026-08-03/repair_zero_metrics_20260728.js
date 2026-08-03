function repairZeroMetricBlanks20260728() {
  const sheet = getSheet_();
  const repairs = [
    { row: 65, url: "https://www.instagram.com/reel/DZrwqKShr30/", dateLabel: "7.13", value: 5871 },
    { row: 69, url: "https://www.instagram.com/reel/DZw2WS_vW3X/", dateLabel: "7.13", value: 203936 },
    { row: 88, url: "https://www.youtube.com/shorts/TW0sMmr1XbY", dateLabel: "7.11", value: 158727 },
    { row: 1432, url: "https://www.instagram.com/reels/DaU7ckzvS0X/", dateLabel: "7.27", value: 3261 },
    { row: 1434, url: "https://www.instagram.com/reels/DbFwKV9vnzM/", dateLabel: "7.27", value: 1919 },
  ];

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0].map(function(v) {
    return String(v || "").trim();
  });
  const urlCol = (typeof findHeaderCol_ === "function" ? findHeaderCol_(sheet, ["게시물URL", "게시물url", "URL"]) : 2) || 2;
  const written = [];

  function dateCol_(label) {
    for (let i = 0; i < headers.length; i++) {
      if (headers[i] === label) return i + 1;
    }
    throw new Error("date column not found: " + label);
  }

  repairs.forEach(function(r) {
    const actualUrl = String(sheet.getRange(r.row, urlCol).getDisplayValue() || "").trim();
    if (linkKey_(actualUrl) !== linkKey_(r.url)) {
      throw new Error("URL mismatch at row " + r.row + ": " + actualUrl + " expected " + r.url);
    }
    const col = dateCol_(r.dateLabel);
    const cell = sheet.getRange(r.row, col);
    const current = cell.getValue();
    if (current !== "" && current !== null && Number(current) !== Number(r.value)) {
      throw new Error("Refusing to overwrite " + r.dateLabel + " row " + r.row + ": " + current + " -> " + r.value);
    }
    if (current === "" || current === null) {
      cell.setValue(r.value);
      written.push(r.dateLabel + r.row + "=" + r.value);
    }
  });

  SpreadsheetApp.flush();
  try { refreshCumulativeViews(); } catch (e) { Logger.log(e && (e.stack || e.message) || e); }
  SpreadsheetApp.flush();
  Logger.log("repairZeroMetricBlanks20260728 written " + written.length + ": " + written.join(", "));
  safeAlert_("누적 조회수 빈칸 복구 완료: " + written.length + "칸\n" + written.join("\n"));
}
