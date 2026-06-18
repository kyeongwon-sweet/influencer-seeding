// YouTube Analytics refresh token 발급 도구 (로컬 1회 실행, 의존성 없음 — Node 18+)
//
// 사전 준비 (GCP, 한 번만):
//   1) console.cloud.google.com → 프로젝트 선택(예: dynamic-music-499614-t2)
//   2) "API 및 서비스 → 라이브러리"에서 "YouTube Analytics API" 사용 설정
//   3) "API 및 서비스 → OAuth 동의 화면": User Type=외부, 앱 이름 입력, 테스트 사용자에
//      ★유튜브 채널 소유 구글 계정★ 추가 (게시 안 해도 테스트 사용자는 됨)
//   4) "사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID"
//      → 애플리케이션 유형 = "데스크톱 앱" → 만들기 → 클라이언트 ID/보안비밀 복사
//
// 실행:
//   set GOOGLE_CLIENT_ID=...        (PowerShell: $env:GOOGLE_CLIENT_ID="...")
//   set GOOGLE_CLIENT_SECRET=...    (PowerShell: $env:GOOGLE_CLIENT_SECRET="...")
//   node scripts/get-youtube-token.mjs
//   → 브라우저로 동의창 → ★유튜브 채널 소유 계정★으로 로그인·허용 → 터미널에 refresh token 출력

import http from "node:http";
import { exec } from "node:child_process";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT = 53682;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("❌ GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 환경변수를 먼저 설정하세요.");
  process.exit(1);
}

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth?" +
  new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent", // 매번 refresh_token 발급 보장
  });

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8"); // 한글 깨짐 방지
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) { res.end(`인증 실패: ${err}`); console.error("❌", err); server.close(); process.exit(1); }
  if (!code) { res.end("코드 없음"); return; }

  try {
    const tr = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT, grant_type: "authorization_code",
      }),
    });
    const j = await tr.json();
    if (!tr.ok || !j.refresh_token) {
      res.end("토큰 교환 실패 — 터미널 확인");
      console.error("❌ 토큰 교환 실패:", JSON.stringify(j, null, 2));
      console.error("   (refresh_token이 없으면: prompt=consent + access_type=offline 확인, 또는 계정에서 앱 권한 제거 후 재시도)");
      server.close(); process.exit(1);
    }
    res.end("✅ 완료! 터미널로 돌아가세요. 이 창은 닫아도 됩니다.");
    console.log("\n================ 복사하세요 ================");
    console.log("YOUTUBE_REFRESH_TOKEN=" + j.refresh_token);
    console.log("============================================\n");
    console.log("이 값(+ GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)을 전달해 주시면 Vercel에 넣고 마무리하겠습니다.");
  } catch (e) {
    res.end("오류 — 터미널 확인");
    console.error("❌", e);
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 500);
  }
});

server.listen(PORT, () => {
  console.log("브라우저에서 아래 주소를 열어 ★유튜브 채널 소유 구글 계정★으로 로그인·허용하세요:\n");
  console.log(authUrl + "\n");
  // 자동 열기 시도 (Windows: start, mac: open, linux: xdg-open)
  const opener = process.platform === "win32" ? `start "" "${authUrl}"` : process.platform === "darwin" ? `open "${authUrl}"` : `xdg-open "${authUrl}"`;
  exec(opener, () => {});
});
