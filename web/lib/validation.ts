/**
 * 데이터 유효성 검사 함수
 *
 * 목적:
 * - API 응답 및 필터링 로직에서 null/undefined/타입 오류 조기 발견
 * - 재발 방지: 이전 버그(광고비 그래프 미표시, 제로비 필터 오류)의 근본 원인 차단
 */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * 배열 유효성 검사
 * - 언제 사용: API 응답 배열 검증
 * - 예: Meta API 응답이 정말 배열인지 확인
 */
export function validateArray(
  data: unknown,
  fieldName: string = "data"
): ValidationResult {
  const errors: string[] = [];

  if (data === null || data === undefined) {
    errors.push(`${fieldName}이 null/undefined입니다`);
  } else if (!Array.isArray(data)) {
    errors.push(`${fieldName}이 배열이 아닙니다 (받은 타입: ${typeof data})`);
  } else if (data.length === 0) {
    errors.push(`${fieldName}이 비어있습니다`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * 날짜 범위 유효성 검사
 * - 언제 사용: 필터링할 때 dateFrom/dateTo 검증
 * - 목적: "아직 데이터 없는 게시물" edge case 사전 차단
 */
export function validateDateRange(
  dateFrom: string | null,
  dateTo: string | null
): ValidationResult {
  const errors: string[] = [];

  if (!dateFrom && !dateTo) {
    errors.push("dateFrom 또는 dateTo 중 최소 하나는 필수입니다");
    return { valid: false, errors };
  }

  if (dateFrom && !isValidDate(dateFrom)) {
    errors.push(`dateFrom 형식이 잘못되었습니다: ${dateFrom}`);
  }

  if (dateTo && !isValidDate(dateTo)) {
    errors.push(`dateTo 형식이 잘못되었습니다: ${dateTo}`);
  }

  if (dateFrom && dateTo && dateFrom > dateTo) {
    errors.push(
      `dateFrom(${dateFrom})이 dateTo(${dateTo})보다 나중입니다`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * YYYY-MM-DD 형식 유효성 검사
 */
function isValidDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

/**
 * 필터링된 게시물 유효성 검사
 * - 언제 사용: 필터링 후 결과 검증
 * - 목적: 의도치 않은 전체 제외 감지
 */
export function validateFilterResult(
  originalCount: number,
  filteredCount: number,
  filterName: string
): ValidationResult {
  const errors: string[] = [];

  if (filteredCount === 0 && originalCount > 0) {
    errors.push(
      `⚠️ 주의: 필터 "${filterName}" 적용 후 모든 게시물이 제외되었습니다. edge case인지 확인하세요.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * API 응답 구조 검증
 * - 언제 사용: Meta API 응답 검증
 * - 목적: 응답 형식 변경으로 인한 버그 조기 발견
 */
export function validateApiResponse(
  response: unknown,
  expectedFields: string[]
): ValidationResult {
  const errors: string[] = [];

  if (!response || typeof response !== "object") {
    errors.push(`응답이 객체가 아닙니다 (받은 타입: ${typeof response})`);
    return { valid: false, errors };
  }

  for (const field of expectedFields) {
    if (!(field in response)) {
      errors.push(`필드 "${field}"이 응답에 없습니다`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
