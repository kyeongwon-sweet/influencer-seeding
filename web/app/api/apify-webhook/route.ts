import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchDatasetItems } from "@/lib/apify";
import { normalizeYouTubeUrl, normalizeInstagramUrl } from "@/lib/url-utils";

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

  // 웹훅 토큰 검증 (WEBHOOK_SECRET 미설정 시 무조건 차단)
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const token = searchParams.get('token');
  if (!webhookSecret || token !== webhookSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!jobId || !jobType) {
    return NextResponse.json({ error: 'Missing params' }, { status: 400 });
  }

  // Apify 기본 페이로드: { resource: { status, defaultDatasetId, ... }, eventType, ... }
  const body = await req.json() as {
    resource?: { status: string; defaultDatasetId: string };
    // 레거시 payloadTemplate 형식 대응
    status?: string;
    datasetId?: string;
  };
  const supabase = getServerSupabase();

  const runStatus = body.resource?.status || body.status || 'FAILED';
  const datasetId = body.resource?.defaultDatasetId || body.datasetId || '';

  if (runStatus !== 'SUCCEEDED') {
    await supabase.from('jobs').update({ status: 'failed', error: `Apify run: ${runStatus}` }).eq('id', jobId);
    return NextResponse.json({ ok: true });
  }

  // datasetId 누락 시 즉시 실패 처리 (빈 문자열로 Apify API 호출하면 404)
  if (!datasetId) {
    await supabase.from('jobs').update({ status: 'failed', error: 'Apify webhook: datasetId 없음' }).eq('id', jobId);
    return NextResponse.json({ ok: true });
  }

  try {
    const items = await fetchDatasetItems(datasetId) as Record<string, unknown>[];

    if (jobType === 'monitoring') {
      await handleMonitoring(supabase, jobId, items);

    } else if (jobType === 'listup') {
      const platform = searchParams.get('platform') || 'instagram';
      await handleListup(supabase, jobId, items, platform);

    } else if (jobType === 'screening') {
      const platform = searchParams.get('platform') || 'instagram';
      const influencerId = searchParams.get('influencerId');
      const influencerUrl = searchParams.get('influencerUrl');
      await handleScreening(supabase, jobId, items, platform, influencerId, influencerUrl);

    } else if (jobType === 'organic') {
      const platform = searchParams.get('platform') || 'instagram';
      await handleOrganic(supabase, jobId, items, platform);

    } else if (jobType === 'organic_refresh') {
      await handleOrganicRefresh(supabase, jobId, items);
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

  // statsByKey 빌드 후 필요한 username만 추려서 influencer 조회 (전체 로드 대신 targeted 쿼리)
  const neededUrls = [...new Set(
    (posts || [])
      .filter(p => !p.influencer_id)
      .map(p => {
        const s = statsByKey[statsKey(p.url)];
        return s?.owner_username ? `https://www.instagram.com/${s.owner_username}/` : null;
      })
      .filter(Boolean) as string[]
  )];
  const { data: matchedInfs } = neededUrls.length > 0
    ? await supabase.from('influencers').select('id, url').in('url', neededUrls)
    : { data: [] };
  const infUrlMap = new Map((matchedInfs || []).map((i: { id: string; url: string }) => [i.url, i.id]));

  const rows = [];
  const pendingUpdates: { id: string; updates: Record<string, unknown> }[] = [];
  for (const post of posts || []) {
    const key = statsKey(post.url);
    const s = statsByKey[key];
    if (!s) continue;

    const updates: Record<string, unknown> = {};
    if (!post.posted_at && s.posted_at) updates.posted_at = s.posted_at;
    if (!post.account_name && s.account_name) updates.account_name = s.account_name;
    if (!post.influencer_id && s.owner_username) {
      const profileUrl = `https://www.instagram.com/${s.owner_username}/`;
      const infId = infUrlMap.get(profileUrl);
      if (infId) updates.influencer_id = infId;
    }
    if (Object.keys(updates).length > 0) {
      pendingUpdates.push({ id: post.id, updates });
    }

    rows.push({ post_id: post.id, measured_at: today, play_count: s.play_count, likes_count: s.likes_count, comments_count: s.comments_count });
  }

  // N+1 방지: 병렬 업데이트
  if (pendingUpdates.length > 0) {
    await Promise.all(
      pendingUpdates.map(({ id, updates: upd }) =>
        supabase.from('sponsored_posts').update(upd).eq('id', id)
      )
    );
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
      const isReels = productType === 'clips' || item.type === 'GraphVideo' || item.isVideo;
      if (!isReels) continue; // 릴스만 수집

      const rawTs = item.timestamp || item.takenAtTimestamp;
      const postUploadedAt = typeof rawTs === 'number'
        ? new Date(rawTs * 1000).toISOString()
        : (rawTs as string) || null;

      // keywordSearch:true 모드에서는 item.hashtag가 없음 → null
      const keyword = (item.hashtag as string) || null;

      accounts[username] = {
        name: (item.ownerFullName || (item.owner as Record<string, unknown>)?.fullName || username) as string,
        url: `https://www.instagram.com/${username}/`,
        platform: 'instagram',
        status: 'pending',
        source: 'listup',
        keyword,
        sample_post_url: postUrl,
        post_type: '릴스',
        post_uploaded_at: postUploadedAt,
      };
    }
  } else if (platform === 'youtube') {
    for (const item of items) {
      const rawChannelUrl = (item.channelUrl || item.authorUrl || (item.channelId ? `https://www.youtube.com/channel/${item.channelId}` : null)) as string;
      const channelName = (item.channelName || item.channelTitle || item.author) as string;
      if (!rawChannelUrl || !channelName) continue;

      const normalizedUrl = normalizeYouTubeUrl(rawChannelUrl);
      if (!normalizedUrl) continue;
      const baseUrl = normalizedUrl.replace(/\/$/, '');
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
      if (!isShortVideo) continue; // 쇼츠만 수집

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
        post_type: '숏폼',
        post_uploaded_at: postUploadedAt,
      };
    }
  }

  const newAccounts = Object.values(accounts).filter(a => !existingUrls.has(a.url as string));
  if (newAccounts.length > 0) {
    await supabase.from('influencers').upsert(newAccounts, { onConflict: 'url', ignoreDuplicates: true });
  }
  await supabase.from('jobs').update({ status: 'done', payload: { added: newAccounts.length } }).eq('id', jobId);
}

// ── 스크리닝 ────────────────────────────────────────────────────────

async function handleScreening(
  supabase: ReturnType<typeof getServerSupabase>,
  jobId: string,
  items: Record<string, unknown>[],
  platform: string,
  influencerId: string | null,
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

    // N+1 방지: 필요한 URL 목록으로 한 번에 조회
    const urls = Object.keys(grouped).map(
      rawUrl => normalizeInstagramUrl(rawUrl) ?? (rawUrl.replace(/\/$/, '') + '/')
    );
    const { data: infRows } = await supabase
      .from('influencers').select('id, url').in('url', urls);
    const infByUrl = new Map((infRows || []).map((i: { id: string; url: string }) => [i.url, i.id]));

    // 각 인플루언서별 처리를 병렬로 실행 (순차 await 대신 Promise.all)
    await Promise.all(Object.entries(grouped).map(async ([rawUrl, posts]) => {
      const url = normalizeInstagramUrl(rawUrl) ?? (rawUrl.replace(/\/$/, '') + '/');
      const infId = infByUrl.get(url);
      if (!infId) return;

      const profile = {
        username: (posts[0]?.ownerUsername as string) || '',
        followers: (posts[0]?.followersCount as number) || 0,
      };
      const metrics = calcMetrics(profile, posts);
      const typeMetrics = calcTypeMetrics(profile, posts, 'instagram');
      const { result: resultStatus, details } = evaluateCriteria(criteria, metrics);

      await supabase.from('screening_metrics').insert({
        influencer_id: infId,
        ...metrics,
        criteria_snapshot: { result: resultStatus, details },
        type_metrics: Object.keys(typeMetrics).length ? typeMetrics : null,
      });

      // 채널명·캡션·썸네일 실제 데이터로 업데이트
      const realName = (posts[0]?.ownerFullName as string) || (posts[0]?.ownerUsername as string) || null;
      const sampleUrl = (posts[0]?.url as string) || null;
      const caption = (posts[0]?.caption as string)?.slice(0, 300) || null;
      const rawTs = posts[0]?.timestamp || posts[0]?.takenAtTimestamp;
      const postUploadedAt = typeof rawTs === 'number'
        ? new Date((rawTs as number) * 1000).toISOString()
        : (rawTs as string) || null;
      const infUpdate: Record<string, unknown> = {};
      if (realName) infUpdate.name = realName;
      if (sampleUrl) infUpdate.sample_post_url = sampleUrl;
      if (caption) infUpdate.content_summary = caption;
      if (postUploadedAt) infUpdate.post_uploaded_at = postUploadedAt;
      if (resultStatus === 'pass' || resultStatus === 'reject') infUpdate.status = resultStatus;
      if (Object.keys(infUpdate).length > 0) {
        await supabase.from('influencers').update(infUpdate).eq('id', infId);
      }
    }));

  } else if (platform === 'youtube') {
    // influencerId 우선(직접 전달), 없으면 URL로 조회 (레거시 대응)
    let influencer: { id: string } | null = null;
    if (influencerId) {
      const { data } = await supabase.from('influencers').select('id').eq('id', influencerId).limit(1);
      influencer = data?.[0] ?? null;
    } else if (influencerUrl) {
      const normalizedUrl = normalizeYouTubeUrl(decodeURIComponent(influencerUrl));
      if (normalizedUrl) {
        const { data } = await supabase.from('influencers').select('id').eq('url', normalizedUrl).limit(1);
        influencer = data?.[0] ?? null;
      }
    }
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

    // 채널명·캡션·썸네일 실제 데이터로 업데이트
    const firstItem = items[0];
    const realName = (firstItem?.channelName || firstItem?.channelTitle || firstItem?.author) as string | null || null;
    const sampleUrl = (firstItem?.url as string) || null;
    const caption = (firstItem?.title as string)?.slice(0, 300) || null;
    const ytUpdate: Record<string, unknown> = {};
    if (realName) ytUpdate.name = realName;
    if (sampleUrl) ytUpdate.sample_post_url = sampleUrl;
    if (caption) ytUpdate.content_summary = caption;
    if (resultStatus === 'pass' || resultStatus === 'reject') ytUpdate.status = resultStatus;
    if (Object.keys(ytUpdate).length > 0) {
      await supabase.from('influencers').update(ytUpdate).eq('id', influencer.id);
    }
  }

  await supabase.from('jobs').update({ status: 'done' }).eq('id', jobId);
}

// ── 무상 노출 조회수 갱신 ────────────────────────────────────────────────

async function handleOrganicRefresh(supabase: ReturnType<typeof getServerSupabase>, jobId: string, items: Record<string, unknown>[]) {
  const updates: { url: string; view_count: number }[] = [];

  for (const item of items) {
    const shortCode = (item.shortCode || item.shortcode) as string | undefined;
    const rawUrl = (item.url as string) || (shortCode ? `https://www.instagram.com/p/${shortCode}/` : null);
    if (!rawUrl) continue;

    const viewCount = (item.videoPlayCount || item.videoViewCount) as number | null | undefined;
    if (!viewCount) continue;

    let cleanUrl: string;
    try {
      const u = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
      cleanUrl = `https://www.instagram.com${u.pathname.replace(/\/$/, '')}/`;
    } catch { continue; }

    updates.push({ url: cleanUrl, view_count: viewCount });
  }

  if (updates.length > 0) {
    await supabase.from('organic_mentions').upsert(updates, { onConflict: 'url' });
  }
  await supabase.from('jobs').update({ status: 'done', payload: { updated: updates.length } }).eq('id', jobId);
}

// ── 무상 노출 ────────────────────────────────────────────────────────

const ORGANIC_MIN_FOLLOWERS = 1_000;  // 팔로워 1천 이상 (이전 1만 → 완화)
const ORGANIC_MIN_VIEWS = 1_000;      // 조회수 1천 이상 (이전 1만 → 완화)

async function handleOrganic(supabase: ReturnType<typeof getServerSupabase>, jobId: string, items: Record<string, unknown>[], platform: string) {
  const rows: Record<string, unknown>[] = [];

  if (platform === 'instagram') {
    for (const item of items) {
      // #광고·#협찬 태그 포함 게시물 제외
      if (isAd(item)) continue;
      // 릴스만 수집
      if (!isReel(item)) continue;

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
        view_count: viewCount > 0 ? viewCount : null,
        source: 'apify',
      });
    }
  } else if (platform === 'youtube') {
    for (const item of items) {
      const rawUrl = item.url as string;
      // 쇼츠만 수집 (URL에 /shorts/ 포함 여부로 판별)
      if (!rawUrl || !rawUrl.includes('/shorts/')) continue;

      // 비디오 URL 정리 (쿼리파라미터 제거, 채널 URL로 normalize하지 않음)
      let cleanUrl: string;
      try {
        const u = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
        cleanUrl = `https://www.youtube.com${u.pathname}`;
      } catch { continue; }

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
        url: cleanUrl,
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
