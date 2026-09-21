import { NextRequest, NextResponse } from "next/server";
import { verifyMetaDataDeletionReceipt } from "@/lib/meta-data-deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body{margin:0;background:#f6f7f9;color:#182230;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{max-width:680px;margin:10vh auto;padding:32px;background:white;border:1px solid #e4e7ec;border-radius:16px;box-shadow:0 8px 30px #10182812}
    h1{margin:0 0 16px;font-size:26px}p{line-height:1.7;margin:10px 0}.status{color:#067647;font-weight:700}
  </style>
</head>
<body><main><h1>${title}</h1>${body}</main></body>
</html>`;
}

function htmlResponse(html: string, status = 200) {
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function GET(req: NextRequest) {
  const confirmationCode = req.nextUrl.searchParams.get("code") || "";
  const proof = req.nextUrl.searchParams.get("proof") || "";
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  if (!verifyMetaDataDeletionReceipt(confirmationCode, proof, appSecret)) {
    return htmlResponse(
      page("데이터 삭제 요청 확인 실패", "<p>유효하지 않거나 손상된 확인 주소입니다.</p>"),
      400,
    );
  }

  return htmlResponse(page(
    "데이터 삭제 요청 완료",
    `<p class="status">처리 완료</p>
     <p>인스타 광고 부정댓글 감시·숨김 봇의 데이터 삭제 요청이 정상 처리되었습니다.</p>
     <p>이 앱은 Facebook 앱 범위 사용자 프로필을 저장하지 않으므로, 요청 사용자와 연결해 삭제할 저장 데이터가 없음을 확인하고 즉시 완료했습니다.</p>
     <p>확인 코드: <strong>${confirmationCode}</strong></p>`,
  ));
}
