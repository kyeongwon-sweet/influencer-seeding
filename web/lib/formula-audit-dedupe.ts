export const FORMULA_AUDIT_SERVICE = "formula-audit-slack-report";

export function shouldSkipFormulaAuditReport(opts: { alreadyReported: boolean; force: boolean }): boolean {
  return opts.alreadyReported && !opts.force;
}
