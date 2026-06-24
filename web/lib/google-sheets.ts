import crypto from "crypto";

// 서비스 계정으로 Google Sheets API(read-only)에 접근한다.
// 의존성 추가 없이 Node crypto 로 RS256 JWT 를 서명해 access token 을 받는다.
// 필요한 환경변수:
//   GOOGLE_SA_CLIENT_EMAIL  - 서비스 계정 이메일
//   GOOGLE_SA_PRIVATE_KEY   - 서비스 계정 private key (PEM, \n 포함)

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

let _cached: { token: string; exp: number } | null = null;

// Vercel 환경변수에 붙여넣을 때 따옴표 포함·줄바꿈 깨짐 등으로 PEM이 손상되는 경우가 많아,
// 어떤 형태로 들어와도 base64 본문만 추출해 표준 PKCS8 PEM으로 재구성한다.
export function normalizePrivateKey(raw: string): string {
  const body = raw
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\\n/g, "")      // 리터럴 \n
    .replace(/[\s"']/g, "");  // 실제 공백/줄바꿈/따옴표
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
}

async function getAccessToken(): Promise<string> {
  const email = process.env.GOOGLE_SA_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_SA_PRIVATE_KEY;
  if (!email || !rawKey) {
    throw new Error("GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY 환경변수가 설정되지 않았습니다.");
  }
  const key = normalizePrivateKey(rawKey);

  const now = Math.floor(Date.now() / 1000);
  if (_cached && _cached.exp - 60 > now) return _cached.token;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const signingInput = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = base64url(signer.sign(key));
  const assertion = `${signingInput}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Google 토큰 발급 실패 (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  _cached = { token: json.access_token, exp: now + json.expires_in };
  return json.access_token;
}

// gid(sheetId) 로 탭 제목을 찾는다.
async function getSheetTitleByGid(spreadsheetId: string, gid: number): Promise<string> {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(sheetId,title))`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`스프레드시트 메타 조회 실패 (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { sheets: { properties: { sheetId: number; title: string } }[] };
  const sheet = json.sheets.find((s) => s.properties.sheetId === gid);
  if (!sheet) throw new Error(`gid=${gid} 탭을 찾을 수 없습니다.`);
  return sheet.properties.title;
}

// 지정한 탭의 셀 값을 2차원 배열로 가져온다. (UNFORMATTED_VALUE → 숫자는 number)
export async function fetchSheetTabValues(
  spreadsheetId: string,
  gid: number,
  a1Range = "A1:AB200"
): Promise<(string | number | null)[][]> {
  const title = await getSheetTitleByGid(spreadsheetId, gid);
  const token = await getAccessToken();
  const range = encodeURIComponent(`${title}!${a1Range}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`시트 값 조회 실패 (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { values?: (string | number | null)[][] };
  return json.values ?? [];
}

// 스프레드시트의 모든 탭 제목 목록.
export async function getSheetTitles(spreadsheetId: string): Promise<string[]> {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets(properties(title))`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`스프레드시트 메타 조회 실패 (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { sheets: { properties: { title: string } }[] };
  return json.sheets.map((s) => s.properties.title);
}

// 탭 '제목'으로 셀 값을 2차원 배열로 가져온다. (gid 대신 이름 사용)
export async function fetchSheetTabValuesByTitle(
  spreadsheetId: string,
  title: string,
  a1Range = "A1:AB200"
): Promise<(string | number | null)[][]> {
  const token = await getAccessToken();
  const range = encodeURIComponent(`${title}!${a1Range}`);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) throw new Error(`시트 값 조회 실패 (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as { values?: (string | number | null)[][] };
  return json.values ?? [];
}
