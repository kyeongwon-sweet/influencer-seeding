import { redirect } from "next/navigation";

// 진입 기본 랜딩을 '협찬 모니터링'으로. 홈 대시보드는 /home 으로 이동됨(사이드바 '홈').
export default function RootPage() {
  redirect("/monitoring");
}
