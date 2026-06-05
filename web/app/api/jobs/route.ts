import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse, after } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { startActorRun } from "@/lib/apify";
import { normalizeYouTubeUrl, normalizeInstagramUrl, normalizeUrl } from "@/lib/url-utils";
import { logger } from "@/lib/logger";

/** 공통 설정 */
const CONFIG = {
  APIFY_IG_URL_RE: /^(https:\/\/|\/)(www\.)?instagram\.com\/[A-Za-z0-9\-._]+(\/.*)?$/,
  SCREENING_BATCH: 5,
  ORGANIC_KEYWORDS: ['라라스윗', 'lalasweet'],
} as const;

/** 인스타그램 URL을 Apify가 허용하는 형식으로 정규화. 실패 시 null 반환 */
/**
 * Instagram URL 정규화
 * normalizeInstagramUrl + normalizeUrl 조합:
 * 1. normalizeInstagramUrl: Instagram 프로필만 (포스트는 null)
 * 2. normalizeUrl: 일반 정규화 (프로토콜, trailing slash, 쿼리)
 * 3. APIFY_IG_URL_RE: Apify 검증
 */
function cleanInstagramUrl(url: string): string | null {
  try {
    // Instagram 프로필 정규화 (포스트 URL은 null)
    const igProfile = normalizeInstagramUrl(url);
    if (!igProfile) return null;

    // 일반 정규화 (프로토콜, trailing slash, 쿼리 등)
    const normalized = normalizeUrl(igProfile) || igProfile;

    // Apify 포맷 검증
    return CONFIG.APIFY_IG_URL_RE.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

/** 공통: 액터 실행 오류 처리 */
async function runActorsWithErrorHandling(
  runPromises: Array<Promise<void>>,
  expectedCount: number,
  errorCollector: string[]
): Promise<{ success: number }> {
  await Promise.all(runPromises);
  const success = expectedCount - errorCollector.length;
  if (success === 0) {
    throw new Error('모든 플랫폼 실패: ' + errorCollector.join(' | '));
  }
  if (errorCollector.length > 0) {
    console.warn(`[WARN] 일부 플랫폼 실패: ${errorCollector.join(' | ')}`);
  }
  return { success };
}

function getAppUrl() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function webhookUrl(appUrl: string, params: string): string {
  const secret = process.env.WEBHOOK_SECRET ?? '';
  return `${appUrl}/api/apify-webhook?token=${encodeURIComponent(secret)}&${params}`;
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
  const VALID_JOB_TYPES = ['monitoring', 'listup', 'organic', 'organic_refresh', 'screening'] as const;
  if (!VALID_JOB_TYPES.includes(type as typeof VALID_JOB_TYPES[number])) {
    return NextResponse.json({ error: '허용되지 않는 작업 유형입니다.' }, { status: 400 });
  }
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
            webhookUrl(appUrl, `jobId=${job.id}&jobType=monitoring`)
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
          const actorRuns: Promise<void>[] = [];
          let expectedCount = 0;

          if (igKws.length > 0) {
            expectedCount++;
            actorRuns.push(
              startActorRun(
                'apify/instagram-hashtag-scraper',
                { hashtags: igKws, resultsLimit: 50, resultsType: 'reels', keywordSearch: false },
                webhookUrl(appUrl, `jobId=${job.id}&jobType=listup&platform=instagram`)
              ).catch((e: unknown) => { startErrors.push(`인스타: ${e}`); })
            );
          }
          if (ytKws.length > 0) {
            expectedCount++;
            actorRuns.push(
              startActorRun(
                'streamers/youtube-scraper',
                { searchQueries: ytKws, maxResultsShorts: 30, sortingOrder: 'views' },
                webhookUrl(appUrl, `jobId=${job.id}&jobType=listup&platform=youtube`)
              ).catch((e: unknown) => { startErrors.push(`유튜브: ${e}`); })
            );
          }

          await runActorsWithErrorHandling(actorRuns, expectedCount, startErrors);
          if (startErrors.length > 0) {
            await supabase.from('jobs').update({ error: startErrors.join(' | ') }).eq('id', job.id);
          }
        }

      } else if (type === 'organic') {
        await supabase.from('jobs').update({ status: 'running' }).eq('id', job.id);
        const startErrors: string[] = [];
        const actorRuns = [
          startActorRun(
            'streamers/youtube-scraper',
            { searchQueries: CONFIG.ORGANIC_KEYWORDS, maxResultsShorts: 100, sortingOrder: 'relevance' },
            webhookUrl(appUrl, `jobId=${job.id}&jobType=organic&platform=youtube`)
          ).catch((e: unknown) => { startErrors.push(`유튜브: ${e}`); }),
          startActorRun(
            'apidojo/twitter-scraper-lite',
            { searchTerms: CONFIG.ORGANIC_KEYWORDS, maxResults: 100 },
            webhookUrl(appUrl, `jobId=${job.id}&jobType=organic&platform=twitter`)
          ).catch((e: unknown) => { startErrors.push(`X: ${e}`); }),
          startActorRun(
            'clockworks/tiktok-scraper',
            { searchTerm: CONFIG.ORGANIC_KEYWORDS[0], maxResults: 100 },
            webhookUrl(appUrl, `jobId=${job.id}&jobType=organic&platform=tiktok`)
          ).catch((e: unknown) => { startErrors.push(`틱톡: ${e}`); }),
          startActorRun(
            'astromancer/naver-blog-scraper',
            { keyword: CONFIG.ORGANIC_KEYWORDS[0], maxResults: 50 },
            webhookUrl(appUrl, `jobId=${job.id}&jobType=organic&platform=blog`)
          ).catch((e: unknown) => { startErrors.push(`블로그: ${e}`); }),
          startActorRun(
            'fututeshrub/meta-threads-scraper',
            { searchQuery: CONFIG.ORGANIC_KEYWORDS[0], maxResults: 100 },
            webhookUrl(appUrl, `jobId=${job.id}&jobType=organic&platform=threads`)
          ).catch((e: unknown) => { startErrors.push(`스레드: ${e}`); }),
        ];
        await runActorsWithErrorHandling(actorRuns, 5, startErrors);
        if (startErrors.length > 0) {
          await supabase.from('jobs').update({ error: `일부 플랫폼 실패: ${startErrors.join(' | ')}` }).eq('id', job.id);
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
            webhookUrl(appUrl, `jobId=${job.id}&jobType=organic_refresh`)
          );
        }

      } else if (type === 'screening') {
        const influencerIds = payload?.influencer_ids as string[] | undefined;
        const allInfluencers = (await supabase.from('influencers').select('id, name, url, platform')).data || [];
        const screened = (await supabase.from('screening_metrics').select('influencer_id')).data || [];
        const screenedIds = new Set(screened.map((s: { influencer_id: string }) => s.influencer_id));

        const unscreened = influencerIds?.length
          ? allInfluencers.filter((i: { id: string }) => influencerIds.includes(i.id))
          : allInfluencers.filter((i: { id: string }) => !screenedIds.has(i.id));
        const influencers = unscreened.slice(0, CONFIG.SCREENING_BATCH);

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
          const actorRuns: Promise<void>[] = [];
          let expectedCount = 0;

          if (igUrls.length > 0) {
            expectedCount++;
            logger.info("jobs-api", "Instagram 스크리닝 시작", {
              urlCount: igUrls.length,
              urls: igUrls.slice(0, 3), // 처음 3개만 로깅
            });
            actorRuns.push(
              startActorRun(
                'apify/instagram-scraper',
                { directUrls: igUrls, resultsType: 'posts', resultsLimit: 60, addParentData: true },
                webhookUrl(appUrl, `jobId=${job.id}&jobType=screening&platform=instagram`)
              ).catch((e: unknown) => {
                logger.error("jobs-api", "Instagram 스크리닝 실패", {
                  urlCount: igUrls.length,
                  error: String(e),
                });
                startErrors.push(`인스타: ${e}`);
              })
            );
          }

          ytInfluencers.forEach((inf: { id: string; url: string }) => {
            expectedCount++;
            // YouTube URL 정규화: normalizeYouTubeUrl (YouTube 특수처리) → normalizeUrl (일반 정규화)
            // 목적: Apify에 전달할 URL을 정규화해서 데이터 일관성 보장
            const ytUrl = normalizeUrl(normalizeYouTubeUrl(inf.url) ?? inf.url) ?? inf.url;
            logger.info("jobs-api", "YouTube 스크리닝 시작", {
              influencerId: inf.id,
              originalUrl: inf.url,
              normalizedUrl: ytUrl,
            });
            actorRuns.push(
              startActorRun(
                'streamers/youtube-scraper',
                { startUrls: [{ url: ytUrl }], maxResultsShorts: 15 },
                webhookUrl(appUrl, `jobId=${job.id}&jobType=screening&platform=youtube&influencerId=${inf.id}`)
              ).catch((e: unknown) => {
                logger.error("jobs-api", "YouTube 스크리닝 실패", {
                  influencerId: inf.id,
                  error: String(e),
                });
                startErrors.push(`유튜브: ${e}`);
              })
            );
          });

          await runActorsWithErrorHandling(actorRuns, expectedCount, startErrors);
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
