import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

const NOTION_DB_NAME = "고객 생소리 트래킹";

function inferPlatform(url: string, channelType: string): string {
  if (url.includes("instagram.com")) return "인스타그램";
  if (url.includes("youtu")) return "유튜브";
  if (url.includes("blog.naver.com")) return "블로그";
  if (url.includes("tiktok.com")) return "틱톡";
  if (url.includes("x.com") || url.includes("twitter.com")) return "X (트위터)";
  if (channelType === "확인채널_블로그" || channelType === "확인채널_카페") return "블로그";
  if (channelType === "커뮤니티") return "스레드";
  return "인스타그램";
}

type NotionPropertyValue =
  | { type: "title"; title: { plain_text: string }[] }
  | { type: "rich_text"; rich_text: { plain_text: string }[] }
  | { type: "url"; url: string | null }
  | { type: "number"; number: number | null }
  | { type: "select"; select: { name: string } | null }
  | { type: "multi_select"; multi_select: { name: string }[] }
  | { type: string; [key: string]: unknown };

type NotionPage = { properties: Record<string, NotionPropertyValue> };

// NotionPropertyValue 유니온에 catch-all 멤버가 있어 prop.type 가드 후에도 속성이 unknown으로 좁혀짐 →
// 타입 가드 통과 후 해당 변형으로 명시 단언(런타임 안전, Notion 응답 구조는 가드로 보장).
function getText(prop: NotionPropertyValue | undefined): string | null {
  if (!prop) return null;
  if (prop.type === "title") return (prop as { title: { plain_text: string }[] }).title[0]?.plain_text ?? null;
  if (prop.type === "rich_text") return (prop as { rich_text: { plain_text: string }[] }).rich_text[0]?.plain_text ?? null;
  return null;
}
function getUrl(prop: NotionPropertyValue | undefined): string | null {
  if (!prop || prop.type !== "url") return null;
  return (prop as { url: string | null }).url ?? null;
}
function getNumber(prop: NotionPropertyValue | undefined): number | null {
  if (!prop || prop.type !== "number") return null;
  return (prop as { number: number | null }).number ?? null;
}
function getSelect(prop: NotionPropertyValue | undefined): string {
  if (!prop || prop.type !== "select") return "";
  return (prop as { select: { name: string } | null }).select?.name ?? "";
}
function getMultiSelect(prop: NotionPropertyValue | undefined): string | null {
  if (!prop || prop.type !== "multi_select") return null;
  const names = (prop as { multi_select: { name: string }[] }).multi_select.map((s) => s.name).join(", ");
  return names || null;
}

function notionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.NOTION_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "NOTION_API_TOKEN 환경변수가 없습니다. Vercel > Settings > Environment Variables에서 추가하세요." },
      { status: 503 }
    );
  }

  // ── 1. DB ID 결정 ─────────────────────────────────────────────────
  // 우선순위: NOTION_DB_ID 환경변수 → Search API로 이름 탐색
  let dbId = process.env.NOTION_DB_ID ?? null;

  if (!dbId) {
    const searchRes = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: notionHeaders(token),
      body: JSON.stringify({
        query: NOTION_DB_NAME,
        filter: { property: "object", value: "database" },
        page_size: 10,
      }),
    });

    if (!searchRes.ok) {
      const err = await searchRes.text();
      return NextResponse.json(
        { error: `Notion 검색 실패 (${searchRes.status}): ${err}` },
        { status: 502 }
      );
    }

    const searchData = await searchRes.json();
    const found = (searchData.results ?? []).find(
      (r: { object: string }) => r.object === "database"
    ) as { id: string } | undefined;

    if (!found) {
      return NextResponse.json(
        {
          error:
            `Notion에서 "${NOTION_DB_NAME}" 데이터베이스를 찾을 수 없습니다.\n` +
            "다음 중 하나를 확인하세요:\n" +
            "① Notion DB 우측 상단 ⋯ > Connections > Integration 추가\n" +
            "② Vercel 환경변수에 NOTION_DB_ID 직접 지정 (Notion DB URL에서 마지막 32자리)",
        },
        { status: 404 }
      );
    }

    dbId = found.id;
  }

  // ── 2. DB 전체 조회 (페이지네이션) ────────────────────────────────
  const allPages: NotionPage[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const queryRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: "POST",
      headers: notionHeaders(token),
      body: JSON.stringify(body),
    });

    if (!queryRes.ok) {
      const errText = await queryRes.text();
      let hint = "";
      if (queryRes.status === 404) {
        hint =
          "\n\n해결 방법:\n" +
          "① Notion DB 페이지에서 ⋯ > Connections > Integration을 확인하세요.\n" +
          "② DB URL에서 ID를 복사해 Vercel 환경변수 NOTION_DB_ID로 설정하세요.\n" +
          `   현재 사용된 ID: ${dbId}`;
      }
      return NextResponse.json(
        { error: `Notion DB 조회 실패 (${queryRes.status}): ${errText}${hint}` },
        { status: 502 }
      );
    }

    const queryData = await queryRes.json();
    allPages.push(...(queryData.results ?? []));
    cursor = queryData.has_more ? queryData.next_cursor : undefined;
  } while (cursor);

  // ── 3. 데이터 변환 ────────────────────────────────────────────────
  const mentions = allPages
    .map((page) => {
      const props = page.properties;

      // 채널명: title 타입 속성 자동 감지
      const titleEntry = Object.values(props).find((p) => p.type === "title");
      const channelName = getText(titleEntry) ?? getText(props["채널명"]) ?? null;

      const channelType = getSelect(props["채널 유형"]);

      // URL: 여러 컬럼명 순서대로 탐색
      const urlValue =
        getUrl(props["URL"]) ??
        getUrl(props["url"]) ??
        getUrl(props["게시물 URL"]) ??
        getUrl(props["링크"]) ??
        getUrl(props["userDefined:URL"]) ??
        getUrl(Object.values(props).find((p) => p.type === "url")) ??
        "";

      const viewCount =
        getNumber(props["조회수"]) ?? getNumber(props["조회 수"]) ?? null;

      const content =
        getText(props["내용"]) ??
        getText(props["내용 요약"]) ??
        getText(props["메모"]) ??
        null;

      const products =
        getMultiSelect(props["제품"]) ??
        getMultiSelect(props["상품"]) ??
        getText(props["제품"]) ??
        null;

      return {
        url: urlValue,
        account_name: channelName,
        platform: inferPlatform(urlValue, channelType),
        content_summary: content,
        mentioned_product: products,
        uploaded_at: null as string | null,
        view_count: viewCount,
        source: "notion",
      };
    })
    .filter((m) => m.url);

  // ── 4. 중복 제거 후 삽입 ──────────────────────────────────────────
  const supabase = getServerSupabase();
  const { data: existing } = await supabase.from("organic_mentions").select("url");
  const existingUrls = new Set((existing ?? []).map((m: { url: string }) => m.url));
  const newMentions = mentions.filter((m) => !existingUrls.has(m.url));

  if (newMentions.length === 0) {
    return NextResponse.json({ added: 0, total: allPages.length });
  }

  const { error } = await supabase.from("organic_mentions").insert(newMentions);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ added: newMentions.length, total: allPages.length });
}
