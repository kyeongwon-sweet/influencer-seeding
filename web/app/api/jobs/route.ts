import { auth, currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { startActorRun } from "@/lib/apify";

function getServerSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

function getAppUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getServerSupabase();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, type, status, payload, user_email, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(10);

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

  try {
    if (type === 'monitoring') {
      const { data: posts } = await supabase.from('sponsored_posts').select('url');
      const urls = (posts || []).map((p: { url: string }) => p.url);

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
        if (igKws.length > 0) {
          await startActorRun(
            'apify/instagram-hashtag-scraper',
            { hashtags: igKws, resultsLimit: 100, type: 'recent' },
            `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=listup&platform=instagram`
          );
        }
        if (ytKws.length > 0) {
          await startActorRun(
            'streamers/youtube-scraper',
            { searchQueries: ytKws, maxResults: 100, maxResultsShorts: 100, sortingOrder: 'views' },
            `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=listup&platform=youtube`
          );
        }
      }

    } else if (type === 'screening') {
      const influencerIds = payload?.influencer_ids as string[] | undefined;
      const allInfluencers = (await supabase.from('influencers').select('id, name, url, platform')).data || [];
      const screened = (await supabase.from('screening_metrics').select('influencer_id')).data || [];
      const screenedIds = new Set(screened.map((s: { influencer_id: string }) => s.influencer_id));

      let influencers = influencerIds?.length
        ? allInfluencers.filter((i: { id: string }) => influencerIds.includes(i.id))
        : allInfluencers.filter((i: { id: string }) => !screenedIds.has(i.id));

      if (influencers.length === 0) {
        await supabase.from('jobs').update({ status: 'done', payload: { screened: 0 } }).eq('id', job.id);
      } else {
        await supabase.from('jobs').update({ status: 'running' }).eq('id', job.id);
        const igInfluencers = influencers.filter((i: { platform: string }) => i.platform === 'instagram');
        const ytInfluencers = influencers.filter((i: { platform: string }) => i.platform === 'youtube');

        if (igInfluencers.length > 0) {
          await startActorRun(
            'apify/instagram-scraper',
            {
              directUrls: igInfluencers.map((i: { url: string }) => i.url),
              resultsType: 'posts',
              resultsLimit: 60,
              addParentData: true,
            },
            `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=screening&platform=instagram`
          );
        }
        for (const inf of ytInfluencers) {
          await startActorRun(
            'streamers/youtube-scraper',
            { startUrls: [{ url: inf.url }], maxResults: 60, maxResultsShorts: 60 },
            `${appUrl}/api/apify-webhook?jobId=${job.id}&jobType=screening&platform=youtube&influencerUrl=${encodeURIComponent(inf.url)}`
          );
        }
      }
    }
  } catch (e) {
    await supabase.from("jobs").update({ status: "failed", error: String(e) }).eq("id", job.id);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }

  return NextResponse.json({ job });
}
