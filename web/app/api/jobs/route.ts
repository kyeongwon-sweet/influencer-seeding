import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse, after } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { startActorRun } from "@/lib/apify";
import { normalizeYouTubeUrl } from "@/lib/url-utils";

/** Apify instagram-scraper directUrls 허용 정규식 (400 invalid-input 방지) */
const APIFY_IG_URL_RE = /^(https:\/\/|\/)(www\.)?instagram\.com\/[A-Za-z0-9\-._]+(\/.*)?$/;

/** 인스타그램 URL을 Apify가 허용하는 형식으로 정규화. 실패 시 null 반환 */
function cleanInstagramUrl(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    if (!u.hostname.includes('instagram.com')) return null;
    // 쿼리파라미터·해시 제거, trailing slash 제거
    const path = u.pathname.replace(/\/$/, '') || '/';
    const cleaned = `https://www.instagram.com${path}`;
    // Apify 정규식 검증: 통과 못하면 null 반환 (directUrls에서 자동 제외됨)
    return APIFY_IG_URL_RE.test(cleaned) ? cleaned : null;
  } catch {
    return null;
  }
}

function getAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, type, status, payload, user_email, created_at, updated_at, error")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await currentUser();
  const userEmail = user?.emailAddresses?.[0]?.emailAddress ?? null;

  const { type, payload } = await req.json();
  const supabase = getServerSupabase();
  const appUrl = getAppUrl();

  // 잡 생성
  const { data: job, error } = await supabase
    .from("jobs")
    .insert({ type, payload, status: "pending", user_email: userEmail })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 응답을 먼저 보내고, Apify 액터 시작은 백그라운드에서 처리
  after(async () => {
    if (!process.env.APIFY_API_TOKEN) {
      await supabase.from("jobs").update({
        status: "failed",
        error: "APIFY_API_TOKEN 환경변수 없음 — Vercel > Settings > Environment Variables 확인",
      }).eq("id", job.id);
      return;
    }
    try {
      if (type === 'monitoring') {
        const { data: posts } = await supabase.from('sponsored_posts').select('url');
        const urls = [...new Set(
          (posts || [])
            .map((p: { url: string }) => cleanInstagramUrl(p.url))
            .filter((u): u is string => u !== null)
        )];

        if (urls.length === 0) {
          await supabase.from('jobs').update({ status: 'done' }).eq('id', job.id);
        } else {
          await supabase.from('jobs').update({ status: 'running' }).eq('id', job.id);
          await startActorRun(
            'apify/instagram-scraper',
            { directUrls: urls, resultsType: 'posts', resultsLimit: urls.length },
            `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=monitoring`
          );
        }

      } else if (type === 'listup') {
        const { data: kws } = await supabase.from('search_keywords').select('*');
        const keywords = kws || [];
        const igKws = keywords
          .filter((k: { platform: string }) => ['instagram', 'both'].includes(k.platform))
          .map((k: { keyword: string }) => k.keyword);
        const ytKws = keywords
          .filter((k: { platform: string }) => ['youtube', 'both'].includes(k.platform))
          .map((k: { keyword: string }) => k.keyword);

        if (igKws.length === 0 && ytKws.length === 0) {
          await supabase.from('jobs').update({ status: 'done', payload: { added: 0 } }).eq('id', job.id);
        } else {
          await supabase.from('jobs').update({ status: 'running' }).eq('id', job.id);
          const startErrors: string[] = [];
          await Promise.all([
            igKws.length > 0 ? startActorRun(
              'apify/instagram-hashtag-scraper',
              {
                hashtags: igKws,
                resultsLimit: 200,
                resultsType: 'reels',   // 액터 레벨에서 릴스만 필터
                keywordSearch: true,    // 캡션 텍스트 전체 검색 (해시태그 미사용 게시물도 탐색)
              },
              `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=listup&platform=instagram`
            ).catch((e: unknown) => { startErrors.push(`인스타: ${e}`); }) : Promise.resolve(),
            ytKws.length > 0 ? startActorRun(
              'streamers/youtube-scraper',
              { searchQueries: ytKws, maxResultsShorts: 30, sortingOrder: 'views' },
              `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=listup&platform=youtube`
            ).catch((e: unknown) => { startErrors.push(`유튜브: ${e}`); }) : Promise.resolve(),
          ]);
          // 모든 플랫폼이 실패한 경우에만 잡을 실패 처리
          const totalPlatforms = (igKws.length > 0 ? 1 : 0) + (ytKws.length > 0 ? 1 : 0);
          if (startErrors.length === totalPlatforms) {
            throw new Error(startErrors.join(' | '));
          }
          // 일부 실패 시 에러 메시지만 기록 (잡은 계속 실행중 유지)
          if (startErrors.length > 0) {
            await supabase.from('jobs').update({ error: startErrors.join(' | ') }).eq('id', job.id);
          }
        }

      } else if (type === 'organic') {
        await supabase.from('jobs').update({ status: 'running' }).eq('id', job.id);
        const startErrors: string[] = [];
        await Promise.all([
          startActorRun(
            'apify/instagram-hashtag-scraper',
            { hashtags: ['라라스윗'], resultsLimit: 200, type: 'recent' },
            `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=organic&platform=instagram`
          ).catch((e: unknown) => { startErrors.push(`인스타: ${e}`); }),
          startActorRun(
            'streamers/youtube-scraper',
            { searchQueries: ['라라스윗'], maxResultsShorts: 30, sortingOrder: 'relevance' },
            `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=organic&platform=youtube`
          ).catch((e: unknown) => { startErrors.push(`유튜브: ${e}`); }),
        ]);
        if (startErrors.length === 2) {
          throw new Error(startErrors.join(' | '));
        }
        if (startErrors.length > 0) {
          await supabase.from('jobs').update({ error: startErrors.join(' | ') }).eq('id', job.id);
        }

      } else if (type === 'organic_refresh') {
        // 기존 인스타그램 무상노출 게시글 조회수 갱신
        const { data: mentions } = await supabase.from('organic_mentions').select('url, platform');
        const igUrls = ((mentions || []) as { url: string; platform: string }[])
          .filter(m => m.platform === 'instagram' || m.url.includes('instagram.com'))
          .map(m => cleanInstagramUrl(m.url))
          .filter((u): u is string => u !== null);

        if (igUrls.length === 0) {
          await supabase.from('jobs').update({ status: 'done', payload: { updated: 0 } }).eq('id', job.id);
        } else {
          await supabase.from('jobs').update({ status: 'running' }).eq('id', job.id);
          await startActorRun(
            'apify/instagram-scraper',
            { directUrls: igUrls, resultsType: 'posts', resultsLimit: igUrls.length },
            `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=organic_refresh`
          );
        }

      } else if (type === 'screening') {
        const influencerIds = payload?.influencer_ids as string[] | undefined;
        const allInfluencers = (await supabase.from('influencers').select('id, name, url, platform')).data || [];
        const screened = (await supabase.from('screening_metrics').select('influencer_id')).data || [];
        const screenedIds = new Set(screened.map((s: { influencer_id: string }) => s.influencer_id));

        const SCREENING_BATCH = 5; // 1회 최대 처리 채널 수 (비용 제한)
        const unscreened = influencerIds?.length
          ? allInfluencers.filter((i: { id: string }) => influencerIds.includes(i.id))
          : allInfluencers.filter((i: { id: string }) => !screenedIds.has(i.id));
        const influencers = unscreened.slice(0, SCREENING_BATCH);

        if (influencers.length === 0) {
          await supabase.from('jobs').update({ status: 'done', payload: { screened: 0 } }).eq('id', job.id);
        } else {
          await supabase.from('jobs').update({ status: 'running' }).eq('id', job.id);
          const igInfluencers = influencers.filter((i: { platform: string }) => i.platform === 'instagram');
          const ytInfluencers = influencers.filter((i: { platform: string }) => i.platform === 'youtube');

          const igUrls = igInfluencers
            .map((i: { url: string }) => cleanInstagramUrl(i.url))
            .filter((u): u is string => u !== null);

          const startErrors: string[] = [];
          await Promise.all([
            igUrls.length > 0 ? startActorRun(
              'apify/instagram-scraper',
              { directUrls: igUrls, resultsType: 'posts', resultsLimit: 60, addParentData: true },
              `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=screening&platform=instagram`
            ).catch((e: unknown) => { startErrors.push(`인스타 스크리닝: ${e}`); }) : Promise.resolve(),
            ...ytInfluencers.map((inf: { id: string; url: string }) => {
              const ytUrl = normalizeYouTubeUrl(inf.url) ?? inf.url;
              return startActorRun(
                'streamers/youtube-scraper',
                { startUrls: [{ url: ytUrl }], maxResultsShorts: 15 },
                `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=screening&platform=youtube&influencerId=${inf.id}`
              ).catch((e: unknown) => { startErrors.push(`유튜브(${inf.url}): ${e}`); });
            }),
          ]);
          const totalRuns = (igUrls.length > 0 ? 1 : 0) + ytInfluencers.length;
          if (startErrors.length === totalRuns) {
            throw new Error(startErrors.join(' | '));
          }
          if (startErrors.length > 0) {
            await supabase.from('jobs').update({ error: startErrors.join(' | ') }).eq('id', job.id);
          }
        }
      }
    } catch (e) {
      await supabase.from("jobs").update({ status: "failed", error: String(e) }).eq("id", job.id);
    }
  });

  return NextResponse.json({ job });
}
