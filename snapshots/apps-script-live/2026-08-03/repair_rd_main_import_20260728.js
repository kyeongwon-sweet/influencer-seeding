function auditMetricFormulas20260728() {
  const ss = SpreadsheetApp.openById("10WpAQU9TAsi3hRZ3ELvcQYj7Z228ILXfF6BUGz495Ak");
  const sheet = ss.getSheets().find(function(s) { return s.getSheetId() === 1937186871; });
  if (!sheet) throw new Error("content sheet not found");
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const urlCol = findColAudit20260728_(headers, ["게시물URL", "게시글URL"]);
  const cumCol = findColAudit20260728_(headers, ["누적 조회수", "누적조회수"]);
  const incCol = findColAudit20260728_(headers, ["증분값", "증분"]);
  if (urlCol < 0 || cumCol < 0 || incCol < 0) throw new Error("required columns not found");
  const n = Math.max(0, lastRow - 1);
  const values = sheet.getRange(2, 1, n, lastCol).getValues();
  const displays = sheet.getRange(2, 1, n, lastCol).getDisplayValues();
  const formulas = sheet.getRange(2, 1, n, lastCol).getFormulas();
  let urlRows = 0;
  const hBlankNoFormula = [];
  const iBlankNoFormula = [];
  const hFormulaRows = [];
  const iFormulaRows = [];
  const hValueRows = [];
  const iValueRows = [];
  for (let i = 0; i < n; i++) {
    const url = String(displays[i][urlCol] || "").trim();
    if (!url) continue;
    urlRows++;
    const hFormula = String(formulas[i][cumCol] || "");
    const iFormula = String(formulas[i][incCol] || "");
    const hDisplay = String(displays[i][cumCol] || "").trim();
    const iDisplay = String(displays[i][incCol] || "").trim();
    const hValue = values[i][cumCol];
    const iValue = values[i][incCol];
    if (hFormula) hFormulaRows.push(i + 2);
    else if (hDisplay !== "" || (hValue !== "" && hValue != null)) hValueRows.push(i + 2);
    else hBlankNoFormula.push(i + 2);
    if (iFormula) iFormulaRows.push(i + 2);
    else if (iDisplay !== "" || (iValue !== "" && iValue != null)) iValueRows.push(i + 2);
    else iBlankNoFormula.push(i + 2);
  }
  const summary = {
    urlRows: urlRows,
    hFormulaRows: hFormulaRows.length,
    hValueRows: hValueRows.length,
    hBlankNoFormula: hBlankNoFormula.length,
    hBlankNoFormulaSample: hBlankNoFormula.slice(0, 20),
    iFormulaRows: iFormulaRows.length,
    iValueRows: iValueRows.length,
    iBlankNoFormula: iBlankNoFormula.length,
    iBlankNoFormulaSample: iBlankNoFormula.slice(0, 20)
  };
  Logger.log(JSON.stringify(summary));
  return JSON.stringify(summary);
}

function findColAudit20260728_(headers, names) {
  const wanted = {};
  names.forEach(function(name) { wanted[String(name).replace(/\s+/g, "")] = true; });
  for (let i = 0; i < headers.length; i++) {
    if (wanted[String(headers[i] || "").trim().replace(/\s+/g, "")]) return i;
  }
  return -1;
}
