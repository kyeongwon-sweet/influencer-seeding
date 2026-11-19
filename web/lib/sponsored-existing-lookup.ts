export type SponsoredLookupInputRow = {
  url: string;
  normalized_key: string | null;
};

export type SponsoredLookupExistingRow = Record<string, unknown>;

export type SponsoredLookupError = {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
};

export type SponsoredLookupFetch = (
  column: "normalized_key" | "url",
  values: string[],
) => Promise<{
  data: SponsoredLookupExistingRow[] | null;
  error: SponsoredLookupError | null;
}>;

export type SponsoredLookupResult = {
  existingByUrl: Map<string, SponsoredLookupExistingRow>;
  existingByIdentity: Map<string, SponsoredLookupExistingRow>;
  supportsNormalizedKey: boolean;
  normalizedKeyQueries: number;
  urlFallbackQueries: number;
  urlError: SponsoredLookupError | null;
};

function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/**
 * sponsored_posts 기존 행을 normalized_key 우선, URL fallback 순서로 읽는다.
 *
 * 중요한 계약:
 * - normalized_key로 찾은 입력은 URL로 다시 조회하지 않는다.
 * - 키가 없거나 키 조회에서 못 찾은 입력만 URL로 조회한다(legacy normalized_key NULL 포함).
 * - normalized_key 컬럼 조회 자체가 실패하면 예전 스키마로 보고 모든 URL을 조회한다.
 * - URL 조회 오류는 쓰기 전에 호출자에게 그대로 전달한다.
 */
export async function lookupExistingSponsoredRows(
  rows: SponsoredLookupInputRow[],
  fetchRows: SponsoredLookupFetch,
  identityKeyForUrl: (url: string) => string | null,
  chunkSize = 80,
): Promise<SponsoredLookupResult> {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive integer: ${chunkSize}`);
  }

  const existingByUrl = new Map<string, SponsoredLookupExistingRow>();
  const existingByIdentity = new Map<string, SponsoredLookupExistingRow>();
  const identityKeys = uniqueNonEmpty(rows.map(row => row.normalized_key));
  let supportsNormalizedKey = identityKeys.length > 0;
  let normalizedKeyQueries = 0;
  let urlFallbackQueries = 0;

  if (supportsNormalizedKey) {
    for (let i = 0; i < identityKeys.length; i += chunkSize) {
      normalizedKeyQueries += 1;
      const { data, error } = await fetchRows("normalized_key", identityKeys.slice(i, i + chunkSize));
      if (error) {
        // 기존 동작과 동일하게 normalized_key 지원 여부를 보수적으로 false로 내리고,
        // URL 전체 fallback으로 전환한다. 앞선 키 청크의 URL map은 그대로 둔다.
        supportsNormalizedKey = false;
        existingByIdentity.clear();
        break;
      }
      for (const row of data ?? []) {
        const url = String(row.url);
        const key = String(row.normalized_key ?? identityKeyForUrl(url) ?? row.url);
        existingByIdentity.set(key, row);
        existingByUrl.set(url, row);
      }
    }
  }

  const fallbackUrls = uniqueNonEmpty(
    (supportsNormalizedKey
      ? rows.filter(row => !existingByIdentity.has(row.normalized_key ?? row.url))
      : rows
    ).map(row => row.url),
  );

  for (let i = 0; i < fallbackUrls.length; i += chunkSize) {
    urlFallbackQueries += 1;
    const { data, error } = await fetchRows("url", fallbackUrls.slice(i, i + chunkSize));
    if (error) {
      return {
        existingByUrl,
        existingByIdentity,
        supportsNormalizedKey,
        normalizedKeyQueries,
        urlFallbackQueries,
        urlError: error,
      };
    }
    for (const row of data ?? []) {
      const url = String(row.url);
      existingByUrl.set(url, row);
      existingByIdentity.set(identityKeyForUrl(url) ?? url, row);
    }
  }

  return {
    existingByUrl,
    existingByIdentity,
    supportsNormalizedKey,
    normalizedKeyQueries,
    urlFallbackQueries,
    urlError: null,
  };
}
