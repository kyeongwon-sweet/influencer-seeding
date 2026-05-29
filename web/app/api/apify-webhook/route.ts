import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchDatasetItems } from "@/lib/apify";

// ── 지표 계산 (metrics.py 포팅) ─────────────────────────────────────

const AD_KEYWORDS = new Set(['광고', '협찬', 'ad', 'sponsored']);

function isAd(post: Record<string, unknown>): boolean {
  const hashtags = (post.hashtags as string[]) || [];
  return hashtags.some(h => AD_KEYWORDS.has(h.toLowerCase()));
}

function isReel(post: Record<string, unknown>): boolean {
  return post.productType === 'clips';
}

function isShort(post: Record<string, unknown>): boolean {
  return ((post.url as string) || '').includes('/shorts/');
}

function parseTimestamp(ts: string | number | null | undefined): Date {
  if (!ts) return new Date(0);
  if (typeof ts === 'number') return new Date(ts * 1000);
  return new Date((ts as string).replace('Z', '+00:00'));
}

function avg(posts: Record<string, unknown>[], field: string, ndigits = 0): number | null {
  const vals = posts.map(p => p[field] as number).filter(v => v != null);
  if (!vals.length) return null;
  const result = vals.reduce((a, b) => a + b, 0) / vals.length;
  return ndigits ? Math.round(result * 10 ** ndigits) / 10 ** ndigits : Math.round(result);
}

function ratioAvg(posts: Record<string, unknown>[], num: string, den: string): number | null {
  const ratios = posts
    .filter(p => p[num] != null && (p[den] as number) > 0)
    .map(p => ((p[num] as number) / (p[den] as number)) * 100);
  if (!ratios.length) return null;
  return Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 10000) / 10000;
}

function calcMetrics(profile: Record<string, unknown>, posts: Record<string, unknown>[]) {
  const followers = (profile?.followers as number) || 0;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recent = posts.filter(p => parseTimestamp(p.timestamp as string | number) >= cutoff);
  const adPosts = recent.filter(isAd);
  const generalPosts = recent.filter(p => !isAd(p));
  const totalPlay = avg(recent, 'videoPlayCount');
  return {
    followers,
    avg_views_per_follower: totalPlay != null && followers > 0
      ? Math.round((totalPlay / followers) * 100) / 100 : null,
    count_1m_view: recent.filter(p => ((p.videoPlayCount as number) || 0) >= 1_000_000).length,
    total_posts: recent.length,
    general_posts: generalPosts.length,
    ad_posts: adPosts.length,
    total_avg_view_count: avg(recent, 'videoViewCount'),
    general_avg_view_count: avg(generalPosts, 'videoViewCount'),
    ad_avg_view_count: avg(adPosts, 'videoViewCount'),
    total_avg_play_count: totalPlay,
    general_avg_play_count: avg(generalPosts, 'videoPlayCount'),
    ad_avg_play_count: avg(adPosts, 'videoPlayCount'),
    total_like_ratio: ratioAvg(recent, 'likesCount', 'videoPlayCount'),
    general_like_ratio: ratioAvg(generalPosts, 'likesCount', 'videoPlayCount'),
    ad_like_ratio: ratioAvg(adPosts, 'likesCount', 'videoPlayCount'),
    total_comment_ratio: ratioAvg(recent, 'commentsCount', 'videoPlayCount'),
    general_comment_ratio: ratioAvg(generalPosts, 'commentsCount', 'videoPlayCount'),
    ad_comment_ratio: ratioAvg(adPosts, 'commentsCount', 'videoPlayCount'),
    top_ad_play_count: adPosts.length
      ? Math.max(...adPosts.map(p => (p.videoPlayCount as number) || 0)) : null,
    top_ad_post_url: adPosts.length
      ? (adPosts.reduce((a, b) =>
          ((a.videoPlayCount as number) || 0) > ((b.videoPlayCount as number) || 0) ? a : b
        ).url as string) || null : null,
    avg_video_duration: avg(recent, 'videoDuration', 1),
  };
}

function calcTypeMetrics(profile: Record<string, unknown>, posts: Record<string, unknown>[], platform: string) {
  const result: Record<string, ReturnType<typeof calcMetrics>> = {};
  if (platform === 'instagram') {
    const reels = posts.filter(isReel);
    const feed = posts.filter(p => !isReel(p));
    if (reels.length) result.reels = calcMetrics(profile, reels);
    if (feed.length) result.feed = calcMetrics(profile, feed);
  } else if (platform === 'youtube') {
    const longform = posts.filter(p => !isShort(p));
    const shorts = posts.filter(isShort);
    if (longform.length) result.longform = calcMetrics(profile, longform);
    if (shorts.length) result.shorts = calcMetrics(profile, shorts);
  }
  return result;
}

function evaluateCriteria(criteria: Record<string, number | null>, metrics: ReturnType<typeof calcMetrics>) {
  const totalPosts = metrics.total_posts || 0;
  const adPosts = metrics.ad_posts || 0;
  const adRatio = totalPosts > 0 ? Math.round((adPosts / totalPosts) * 100 * 10) / 10 : null;

  const checks = [
    { key: 'min_followers', value: metrics.followers, op: '>=' as const },
    { key: 'min_1m_count', value: metrics.count_1m_view, op: '>=' as const },
    { key: 'min_views_per_follower', value: metrics.avg_views_per_follower, op: '>=' as const },
    { key: 'min_avg_views', value: metrics.total_avg_play_count, op: '>=' as const },
    { key: 'max_ad_ratio', value: adRatio, op: '<=' as const },
  ];

  const activeChecks = checks.filter(c => criteria[c.key] != null);
  if (!activeChecks.length) return { result: 'no_criteria', details: [] };

  let allPassed = true;
  const details = activeChecks.map(c => {
    const threshold = criteria[c.key] as number;
    const ok = c.value != null && (c.op === '>=' ? c.value >= threshold : c.value <= threshold);
    if (!ok) allPassed = false;
    return { key: c.key, op: c.op, threshold, value: c.value, passed: ok };
  });

  return { result: allPassed ? 'pass' : 'reject', details };
}

// ── Webhook 핸들러 ──────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const jobId = searchParams.get('jobId');
  const jobType = searchParams.get('jobType');

  if (!jobId || !jobType) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  const body = await req.json() as { datasetId: string; status: string };
  const supabase = getServerSupabase();

  if (body.status !== 'SUCCEEDED') {
    await supabase.from('jobs').update({ status: 'failed', error: `Apify run: ${body.status}` }).eq('id', jobId);
    return NextResponse.json({ ok: true });
  }

  try {
    const items = await fetchDatasetItems(body.datasetId) as Record<string, unknown>[];

    if (jobType === 'monitoring') {
      await handleMonitoring(supabase, jobId, items);

    } else if (jobType === 'listup') {
      const platform = searchParams.get('platform') || 'instagram';
      await handleListup(supabase, jobId, items, platform);

    } else if (jobType === 'screening') {
      const platform = searchParams.get('platform') || 'instagram';
      const influencerUrl = searchParams.get('influencerUrl');
      await handleScreening(supabase, jobId, items, platform, influencerUrl);

    } else if (jobType === 'organic') {
      const platform = searchParams.get('platform') || 'instagram';
      await handleOrganic(supabase, jobId, items, platform);
    }
  } catch (e) {
    await supabase.from('jobs').update({ status: 'failed', error: String(e) }).eq('id', jobId);
  }

  return NextResponse.json({ ok: true });
}

// ── 모니터링 ────────────────────────────────────────────────────────

async function handleMonitoring(supabase: ReturnType<typeof getServerSupabase>, jobId: string, items: Record<string, unknown>[]) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: posts } = await supabase.from('sponsored_posts').select('id, url, posted_at, account_name, influencer_id');

  const statsKey = (url: string) => {
    const m = (url || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : url.replace(/\/$/, '');
  };

  const statsByKey: Record<string, Record<string, unknown>> = {};
  for (const item of items) {
    const shortcode = (item.shortCode || item.shortcode) as string | undefined;
    const url = (item.url as string) || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : '');
    if (!url) continue;

    const ts = item.timestamp || item.takenAt;
    let postedAt: string | null = null;
    if (typeof ts === 'string') postedAt = ts.slice(0, 10);
    else if (typeof ts === 'number') postedAt = new Date(ts * 1000).toISOString().slice(0, 10);

    const owner = (item.owner as Record<string, unknown>) || {};
    statsByKey[statsKey(url)] = {
      url,
      play_count: item.videoPlayCount || item.videoViewCount || null,
      likes_count: item.likesCount || item.likes || null,
      comments_count: item.commentsCount || item.comments || null,
      posted_at: postedAt,
      account_name: item.ownerFullName || (owner.fullName as string) || item.ownerUsername || (owner.username as string) || null,
      owner_username: item.ownerUsername || (owner.username as string) || null,
    };
  }

  const rows = [];
  for (const post of posts || []) {
    const key = statsKey(post.url);
    const s = statsByKey[key];
    if (!s) continue;

    const updates: Record<string, unknown> = {};
    if (!post.posted_at && s.posted_at) updates.posted_at = s.posted_at;
    if (!post.account_name && s.account_name) updates.account_name = s.account_name;
    if (!post.influencer_id && s.owner_username) {
      const profileUrl = `https://www.instagram.com/${s.owner_username}/`;
      const { data: inf } = await supabase.from('influencers').select('id').eq('url', profileUrl).limit(1);
      if (inf?.[0]) updates.influencer_id = inf[0].id;
    }
    if (Object.keys(updates).length > 0) {
      await supabase.from('sponsored_posts').update(updates).eq('id', post.id);
    }

    rows.push({ post_id: post.id, measured_at: today, play_count: s.play_count, likes_count: s.likes_count, comments_count: s.comments_count });
  }

  if (rows.length > 0) {
    await supabase.from('post_daily_stats').upsert(rows, { onConflict: 'post_id,measured_at' });
  }
  await supabase.from('jobs').update({ status: 'done', payload: { saved: rows.length } }).eq('id', jobId);
}

// ── 리스트업 ────────────────────────────────────────────────────────

async function handleListup(supabase: ReturnType<typeof getServerSupabase>, jobId: string, items: Record<string, unknown>[], platform: string) {
  const { data: existingData } = await supabase.from('influencers').select('url');
  const existingUrls = new Set((existingData || []).map((r: { url: string }) => r.url));

  const accounts: Record<string, Record<string, unknown>> = {};

  if (platform === 'instagram') {
    for (const item of items) {
      const username = (item.ownerUsername || (item.owner as Record<string, unknown>)?.username || item.username) as string;
      if (!username || accounts[username]) continue;

      const shortCode = item.shortCode as string | undefined;
      const postUrl = (item.url as string) || (shortCode ? `https://www.instagram.com/p/${shortCode}/` : null);
      const productType = item.productType as string;
      const postType = productType === 'clips' || item.type === 'GraphVideo' || item.isVideo ? '릴스' : '피드';

      const rawTs = item.timestamp || item.takenAtTimestamp;
      const postUploadedAt = typeof rawTs === 'number'
        ? new Date(rawTs * 1000).toISOString()
        : (rawTs as string) || null;

      // 발굴 키워드: 게시물 해시태그에서 추론
      const hashtags = (item.hashtags as string[]) || [];
      const keyword = null; // 복수 키워드 통합 실행 시 추론 불가

      accounts[username] = {
        name: (item.ownerFullName || (item.owner as Record<string, unknown>)?.fullName || username) as string,
        url: `https://www.instagram.com/${username}/`,
        platform: 'instagram',
        status: 'pending',
        source: 'listup',
        keyword,
        sample_post_url: postUrl,
        post_type: postType,
        post_uploaded_at: postUploadedAt,
      };
    }
  } else if (platform === 'youtube') {
    for (const item of items) {
      const channelUrl = (item.channelUrl || item.authorUrl || (item.channelId ? `https://www.youtube.com/channel/${item.channelId}` : null)) as string;
      const channelName = (item.channelName || item.channelTitle || item.author) as string;
      if (!channelUrl || !channelName) continue;

      const baseUrl = channelUrl.replace(/\/$/, '').split('/shorts')[0].split('/videos')[0];
      const normalizedUrl = baseUrl + '/';
      if (accounts[baseUrl]) continue;

      const videoUrl = item.url as string;
      const duration = item.duration || 0;
      let durationSec = 0;
      if (typeof duration === 'string') {
        const parts = duration.split(':');
        durationSec = parts.reduce((acc, p) => acc * 60 + parseInt(p, 10), 0);
      } else if (typeof duration === 'number') {
        durationSec = duration;
      }
      const isShortVideo = item.isShort || (videoUrl || '').includes('/shorts/') || durationSec <= 60;

      const rawTs = item.date || item.publishedAt || item.uploadDate;
      const postUploadedAt = typeof rawTs === 'number'
        ? new Date(rawTs * 1000).toISOString()
        : (rawTs as string) || null;

      accounts[baseUrl] = {
        name: channelName,
        url: normalizedUrl,
        platform: 'youtube',
        status: 'pending',
        source: 'listup',
        keyword: null,
        sample_post_url: videoUrl || null,
        post_type: isShortVideo ? '숏폼' : '롱폼',
        post_uploaded_at: postUploadedAt,
      };
    }
  }

  const newAccounts = Object.values(accounts).filter(a => !existingUrls.has(a.url as string));
  if (newAccounts.length > 0) {
    await supabase.from('influencers').insert(newAccounts);
  }
  await supabase.from('jobs').update({ status: 'done', payload: { added: newAccounts.length } }).eq('id', jobId);
}

// ── 스크리닝 ────────────────────────────────────────────────────────

async function handleScreening(
  supabase: ReturnType<typeof getServerSupabase>,
  jobId: string,
  items: Record<string, unknown>[],
  platform: string,
  influencerUrl: string | null
) {
  const { data: criteriaData } = await supabase
    .from('screening_criteria')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(1);
  const criteria = criteriaData?.[0] || {};

  if (platform === 'instagram') {
    // 인플루언서 URL별로 게시물 그룹핑
    const grouped: Record<string, Record<string, unknown>[]> = {};
    for (const item of items) {
      const inputUrl = (item.inputUrl as string)?.replace(/\/$/, '');
      if (!inputUrl) continue;
      if (!grouped[inputUrl]) grouped[inputUrl] = [];
      grouped[inputUrl].push(item);
    }

    for (const [rawUrl, posts] of Object.entries(grouped)) {
      const url = rawUrl.endsWith('/') ? rawUrl : rawUrl + '/';
      const { data: infData } = await supabase
        .from('influencers').select('id').eq('url', url).limit(1);
      const influencer = infData?.[0];
      if (!influencer) continue;

      const profile = {
        username: (posts[0]?.ownerUsername as string) || '',
        followers: (posts[0]?.followersCount as number) || 0,
      };
      const metrics = calcMetrics(profile, posts);
      const typeMetrics = calcTypeMetrics(profile, posts, 'instagram');
      const { result: resultStatus, details } = evaluateCriteria(criteria, metrics);

      await supabase.from('screening_metrics').insert({
        influencer_id: influencer.id,
        ...metrics,
        criteria_snapshot: { result: resultStatus, details },
        type_metrics: Object.keys(typeMetrics).length ? typeMetrics : null,
      });

      if (resultStatus === 'pass' || resultStatus === 'reject') {
        await supabase.from('influencers').update({ status: resultStatus }).eq('id', influencer.id);
      }
    }

  } else if (platform === 'youtube' && influencerUrl) {
    const decodedUrl = decodeURIComponent(influencerUrl);
    const { data: infData } = await supabase
      .from('influencers').select('id').eq('url', decodedUrl).limit(1);
    const influencer = infData?.[0];
    if (!influencer) {
      await supabase.from('jobs').update({ status: 'done' }).eq('id', jobId);
      return;
    }

    const subscribers = items.find(i =>
      i.channelSubscriberCount || i.numberOfSubscribers || i.subscriberCount
    );
    const followerCount = subscribers
      ? ((subscribers.channelSubscriberCount || subscribers.numberOfSubscribers || subscribers.subscriberCount) as number)
      : 0;

    const posts = items.map(item => ({
      url: item.url as string,
      videoPlayCount: (item.viewCount || item.views || 0) as number,
      videoViewCount: null,
      likesCount: (item.likes || item.likeCount || 0) as number,
      commentsCount: (item.commentsCount || item.commentCount || 0) as number,
      videoDuration: typeof item.duration === 'string'
        ? item.duration.split(':').reduce((acc: number, p: string) => acc * 60 + parseInt(p, 10), 0)
        : (item.duration as number) || null,
      hashtags: (item.hashtags as string[]) || [],
      timestamp: item.date || item.publishedAt || item.uploadDate,
    }));

    const profile = { followers: followerCount };
    const metrics = calcMetrics(profile, posts as Record<string, unknown>[]);
    const typeMetrics = calcTypeMetrics(profile, posts as Record<string, unknown>[], 'youtube');
    const { result: resultStatus, details } = evaluateCriteria(criteria, metrics);

    await supabase.from('screening_metrics').insert({
      influencer_id: influencer.id,
      ...metrics,
      criteria_snapshot: { result: resultStatus, details },
      type_metrics: Object.keys(typeMetrics).length ? typeMetrics : null,
    });

    if (resultStatus === 'pass' || resultStatus === 'reject') {
      await supabase.from('influencers').update({ status: resultStatus }).eq('id', influencer.id);
    }
  }

  await supabase.from('jobs').update({ status: 'done' }).eq('id', jobId);
}

// ── 무상 노출 ────────────────────────────────────────────────────────

const ORGANIC_MIN_FOLLOWERS = 10_000;
const ORGANIC_MIN_VIEWS = 10_000;

async function handleOrganic(supabase: ReturnType<typeof getServerSupabase>, jobId: string, items: Record<string, unknown>[], platform: string) {
  const rows: Record<string, unknown>[] = [];

  if (platform === 'instagram') {
    for (const item of items) {
      // #광고·#협찬 태그 포함 게시물 제외
      if (isAd(item)) continue;

      const owner = (item.owner as Record<string, unknown>) || {};
      const followers = (item.ownerFollowersCount || owner.followersCount || 0) as number;
      const viewCount = (item.videoPlayCount || item.videoViewCount || 0) as number;

      // 팔로워 1만 이상 (데이터 없으면 통과)
      if (followers > 0 && followers < ORGANIC_MIN_FOLLOWERS) continue;
      // 조회수 1만 이상 (데이터 없으면 통과)
      if (viewCount > 0 && viewCount < ORGANIC_MIN_VIEWS) continue;

      const username = (item.ownerUsername || owner.username) as string;
      if (!username) continue;
      const shortCode = item.shortCode as string | undefined;
      const url = (item.url as string) || (shortCode ? `https://www.instagram.com/p/${shortCode}/` : null);
      if (!url) continue;

      const rawTs = item.timestamp || item.takenAtTimestamp;
      const uploadedAt = typeof rawTs === 'number'
        ? new Date(rawTs * 1000).toISOString().slice(0, 10)
        : rawTs ? (rawTs as string).slice(0, 10) : null;

      rows.push({
        url,
        account_name: username,
        platform: 'instagram',
        content_summary: (item.caption as string)?.slice(0, 300) || null,
        uploaded_at: uploadedAt,
        view_count: viewCount || (item.likesCount as number) || null,
        source: 'apify',
      });
    }
  } else if (platform === 'youtube') {
    for (const item of items) {
      const url = item.url as string;
      if (!url) continue;

      const subscribers = (item.channelSubscriberCount || item.numberOfSubscribers || item.subscriberCount || 0) as number;
      const viewCount = (item.viewCount || item.views || 0) as number;

      // 구독자 1만 이상 (데이터 없으면 통과)
      if (subscribers > 0 && subscribers < ORGANIC_MIN_FOLLOWERS) continue;
      // 조회수 1만 이상 (데이터 없으면 통과)
      if (viewCount > 0 && viewCount < ORGANIC_MIN_VIEWS) continue;

      const channelName = (item.channelName || item.channelTitle || item.author) as string;

      const rawTs = item.date || item.publishedAt || item.uploadDate;
      const uploadedAt = typeof rawTs === 'number'
        ? new Date(rawTs * 1000).toISOString().slice(0, 10)
        : rawTs ? (rawTs as string).slice(0, 10) : null;

      rows.push({
        url,
        account_name: channelName || null,
        platform: 'youtube',
        content_summary: (item.title as string) || null,
        uploaded_at: uploadedAt,
        view_count: viewCount || null,
        source: 'apify',
      });
    }
  }

  if (rows.length > 0) {
    await supabase.from('organic_mentions').upsert(rows, { onConflict: 'url', ignoreDuplicates: false });
  }
  await supabase.from('jobs').update({ status: 'done', payload: { saved: rows.length } }).eq('id', jobId);
}
