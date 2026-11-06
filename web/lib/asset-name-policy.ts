/**
 * Remove upload-file listings accidentally appended to the canonical asset name.
 *
 * The linked sheet is the source of truth for asset_name. A 2026-08 JD멜
 * batch pasted delivery filenames (".mp4, 2. 속지.mp4, …") after the real
 * asset token. Keeping this rule in every write path prevents reintroduction.
 */
export const ASSET_FILE_LIST_PATTERN = /\.(?:zip|png|jpe?g|gif|webp|mp4|mov|pdf)|\s\|\s|\d+\.\s*(?:표지|속지)/i;

export function stripAssetFileListing(value: string | null | undefined): string | null {
  if (value == null) return null;
  // 자모로 쪼개진 한글(NFD)이면 "표지"·"속지" 표식을 못 찾는다 → 먼저 합친다(2026-11-06).
  const text = String(value).normalize("NFC").trim();
  if (!text) return null;
  const match = ASSET_FILE_LIST_PATTERN.exec(text);
  if (!match) return text;
  const clean = text.slice(0, match.index).replace(/[\s,|]+$/g, "").trim();
  return clean || null;
}
