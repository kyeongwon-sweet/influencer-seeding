export const EXPORT_STATS_HEARTBEAT_SERVICE = "apps-script-export-stats";

export type ExportStatsHeartbeatInput = {
  job: "exportStats";
  written_date: string;
  cells_written: number;
  blank_cells_filled: number;
  auto_cells_corrected: number;
  formula_rows_written: number;
  added_date_columns: number;
  source: string;
  write_mode: "full" | "fill_blanks_only";
  import_status: string;
};

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return value;
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseExportStatsHeartbeatInput(value: unknown): ExportStatsHeartbeatInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("body must be an object");
  }
  const input = value as Record<string, unknown>;
  if (input.job !== "exportStats") throw new Error("job must be exportStats");
  const writtenDate = String(input.written_date ?? "");
  if (!isIsoDate(writtenDate)) throw new Error("written_date must be YYYY-MM-DD");
  const source = String(input.source ?? "").trim();
  if (!source || source.length > 80) throw new Error("source is required and must be at most 80 characters");
  const writeMode = String(input.write_mode ?? "");
  if (writeMode !== "full" && writeMode !== "fill_blanks_only") {
    throw new Error("write_mode must be full or fill_blanks_only");
  }
  const importStatus = String(input.import_status ?? "").trim();
  if (!importStatus || importStatus.length > 80) {
    throw new Error("import_status is required and must be at most 80 characters");
  }

  return {
    job: "exportStats",
    written_date: writtenDate,
    cells_written: nonNegativeInteger(input.cells_written, "cells_written"),
    blank_cells_filled: nonNegativeInteger(input.blank_cells_filled, "blank_cells_filled"),
    auto_cells_corrected: nonNegativeInteger(input.auto_cells_corrected, "auto_cells_corrected"),
    formula_rows_written: nonNegativeInteger(input.formula_rows_written, "formula_rows_written"),
    added_date_columns: nonNegativeInteger(input.added_date_columns, "added_date_columns"),
    source,
    write_mode: writeMode,
    import_status: importStatus,
  };
}
