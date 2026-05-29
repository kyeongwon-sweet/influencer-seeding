import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";

// 고객 생소리 트래킹 DB
const NOTION_DB_ID = "2803b344ce7f81a8886fd656e15e643e";

function inferPlatform(url: string, channelType: string): string {
  if (url.includes("instagram.com")) return "인스타그램";
  if (url.includes("youtu")) return "유튜브";
  if (url.includes("blog.naver.com")) return "블로그";
  if (url.includes("tiktok.com")) return "틱톡";
  if (url.includes("x.com") || url.includes("twitter.com")) return "스레드";
  if (channelType === "확인채널_블로그") return "블로그";
  if (channelType === "확인채널_카페") return "블로그";
  if (channelType === "커뮤니티") return "스레드";
  return "인스타그램";
}

interface NotionPage {
  properties: {
    채널명?: { title?: { plain_text: string }[] };
    "채널 유형"?: { select?: { name: string } };
    "userDefined:URL"?: { url?: string };
    조회수?: { number?: number };
    내용?: { rich_text?: { plain_text: string }[] };
    제품?: { multi_select?: { name: string }[] };
  };
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = process.env.NOTION_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "NOTION_API_TOKEN 환경변수가 없습니다. Vercel > Settings > Environment Variables 확인" },
      { status: 503 }
    );
  }

  // Notion DB 조회
  const notionRes = await fetch(`https://api.notion.com/v1/databases/${NOTION_DB_ID}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 100 }),
  });

  if (!notionRes.ok) {
    const err = await notionRes.text();
    return NextResponse.json({ error: `Notion API 오류: ${err}` }, { status: 502 });
  }

  const notionData = await notionRes.json();
  const pages: NotionPage[] = notionData.results ?? [];

  const mentions = pages
    .map((page) => {
      const props = page.properties;
      const channelName = props["채널명"]?.title?.[0]?.plain_text ?? null;
      const channelType = props["채널 유형"]?.select?.name ?? "";
      const url = props["userDefined:URL"]?.url ?? "";
      const viewCount = props["조회수"]?.number ?? null;
      const content = props["내용"]?.rich_text?.[0]?.plain_text ?? null;
      const products = (props["제품"]?.multi_select ?? []).map((s) => s.name).join(", ") || null;

      return {
        url,
        account_name: channelName,
        platform: inferPlatform(url, channelType),
        content_summary: content,
        mentioned_product: products,
        uploaded_at: null as string | null,
        view_count: viewCount,
        source: "notion",
      };
    })
    .filter((m) => m.url);

  const supabase = getServerSupabase();

  // 중복 제거: 기존 URL과 비교
  const { data: existing } = await supabase.from("organic_mentions").select("url");
  const existingUrls = new Set((existing ?? []).map((m: { url: string }) => m.url));
  const newMentions = mentions.filter((m) => !existingUrls.has(m.url));

  if (newMentions.length === 0) {
    return NextResponse.json({ added: 0 });
  }

  const { error } = await supabase.from("organic_mentions").insert(newMentions);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ added: newMentions.length });
}
