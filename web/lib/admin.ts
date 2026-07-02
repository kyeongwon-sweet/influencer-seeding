// 대시보드 관리자(생성자) 이메일 화이트리스트 — 유저 관리(차단/초대) 권한 판정.
// 순수 모듈(서버 import 없음) → 클라이언트/서버 어디서나 사용 가능.
export const ADMIN_EMAILS = ["hwangkw@lalasweet.kr"];

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.toLowerCase());
}
