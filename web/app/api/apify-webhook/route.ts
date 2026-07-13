import { NextRequest, NextResponse } from "next/server";
import { getServerSupabase } from "@/lib/supabase-server";
import { fetchDatasetItems } from "@/lib/apify";
import { normalizeYouTubeUrl, normalizeInstagramUrl } from "@/lib/url-utils";
import { notifyJob } from "@/lib/slack";
import { todayKST } from "@/lib/dateRule";

// ── 지표 계산 (metrics.py 포팅) ─────────────────────────────────────

// 화이트리스트: 해당 키워드 있으면 자발적 언급으로 간주 → 광고 여부 체크 없이 수집
const ORGANIC_WHITELIST = ['내돈내산'];

// 리스트업 제외: 계정명/사용자명에 브랜드·공식 신호 단어가 있으면 수집하지 않음
const BRAND_EXCLUDE_KEYWORDS = ['official', '공식', '은행', 'bank', '카드', 'card', '페이', 'pay', '보험', '증권', '그룹', 'corp'];
function isBrandAccount(...names: (string | null | undefined)[]): boolean {
  const text = names.filter(Boolean).join(' ').toLowerCase();
  return BRAND_EXCLUDE_KEYWORDS.some(k => text.includes(k));
}

function isAd(post: Record<string, unknown>): boolean {
  // 캡션 필드는 플랫폼마다 다름 (IG=caption, 틱톡=text, 트위터=fullText/text)
  const caption = String(post.caption ?? post.text ?? post.fullText ?? '').toLowerCase();
  // 해시태그: IG는 문자열 배열, 틱톡/트위터는 객체 배열({name|title|text}) → 형태 무관하게 문자열 추출
  const hashtags = (Array.isArray(post.hashtags) ? post.hashtags : [])
    .map((h) => (typeof h === 'string' ? h : String((h as Record<string, unknown>)?.name ?? (h as Record<string, unknown>)?.title ?? (h as Record<string, unknown>)?.text ?? '')))
    .filter(Boolean)
    .map((h) => h.toLowerCase());
  const fullText = caption + ' ' + hashtags.join(' ');

  // 내돈내산 있으면 자발적 언급 → 비광고
  if (ORGANIC_WHITELIST.some(k => fullText.includes(k))) return false;

  // (광고) 또는 #광고 패턴만 제외 ("광고 아님" 같은 경우는 통과)
  if (fullText.includes('(광고)') || fullText.includes('#광고')) return true;

  // 기존: #협찬 #ad #sponsored 해시태그 제외
  const adHashtags = new Set(['협찬', 'ad', 'sponsored']);
  return hashtags.some(h => adHashtags.has(h));
}

function isReel(post: Record<string, unknown>): boolean {
  // profile-scraper: productType === 'clips'
  // hashtag-scraper: type === 'Video' or isVideo === true
  return post.productType === 'clips'
    || post.type === 'Video'
    || post.type === 'GraphSidecar' // 슬라이드 릴스
    || post.isVideo === true
    || post.mediaType === 'VIDEO';
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
    total_avg_like_count: avg(recent, 'likesCount'),
    total_avg_comment_count: avg(recent, 'commentsCount'),
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
      await handleMonitoring(supabase, jobId, items, searchParams.get('measuredAt') || searchParams.get('date') || undefined);

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

async function handleMonitoring(supabase: ReturnType<typeof getServerSupabase>, jobId: string, items: Record<string, unknown>[], measuredAt?: string) {
  const today = measuredAt || todayKST();
  const { data: posts } = await supabase.from('sponsored_posts').select('id, url, posted_at, account_name, influencer_id, ended_at, project_name, content_summary');
  const eligiblePosts = (posts || []).filter((p) => {
    const postedAt = p.posted_at ? String(p.posted_at).slice(0, 10) : null;
    return !postedAt || postedAt <= today;
  });

  const statsKey = (url: string) => {
    const m = (url || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : url.replace(/\/$/, '');
  };

  const requestedKeys = new Set(eligiblePosts.map((p) => statsKey(p.url)));
  const statsByKey: Record<string, Record<string, unknown>> = {};
  for (const item of items) {
    const shortcode = (item.shortCode || item.shortcode) as string | undefined;
    const url = (item.url as string) || (shortcode ? `https://www.instagram.com/p/${shortcode}/` : '');
    if (!url) continue;
    const key = statsKey(url);
    if (!requestedKeys.has(key)) continue;

    const ts = item.timestamp || item.takenAt;
    let postedAt: string | null = null;
    if (typeof ts === 'string') postedAt = ts.slice(0, 10);
    else if (typeof ts === 'number') postedAt = new Date(ts * 1000).toISOString().slice(0, 10);

    const owner = (item.owner as Record<string, unknown>) || {};
    statsByKey[key] = {
      url,
      play_count: (item.videoPlayCount ?? item.videoViewCount) ?? null,
      likes_count: (item.likesCount ?? item.likes) ?? null,
      comments_count: (item.commentsCount ?? item.comments) ?? null,
      posted_at: postedAt,
      account_name: item.ownerFullName || (owner.fullName as string) || item.ownerUsername || (owner.username as string) || null,
      owner_username: item.ownerUsername || (owner.username as string) || null,
      content_summary: (item.caption as string)?.slice(0, 300) || null,
    };
  }

  // statsByKey 빌드 후 필요한 username만 추려서 influencer 조회 (전체 로드 대신 targeted 쿼리)
  const neededUrls = [...new Set(
    eligiblePosts
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

  // 🛡️ 안전장치용: today 이전 마지막 조회수·측정일.
  // 전체 히스토리 스캔 대신 '이번 배치(posts)의 post_id'만 조회 → 읽는 양↓(이 웹훅이 소비하는 값은
  // 아래 루프에서 post.id 기준이라 batch id만 있으면 누락 없음). id는 청크로 나눠 URL 한도 회피,
  // 청크마다 measured_at desc 페이지네이션으로 1000행 상한 회피 + '최초 등장 = 최신' 동작 유지.
  const lastKnownPlay = new Map<string, number>();
  const lastMeasuredAt = new Map<string, string>();
  {
    const batchIds = [...new Set(eligiblePosts.map((p: { id: string }) => p.id).filter(Boolean))];
    const ID_CHUNK = 120, PAGE = 1000;
    type PrevRow = { post_id: string; play_count: number | null; measured_at: string };
    const collectPrev = (page: PrevRow[] | null | undefined) => {
      for (const s of page ?? []) {
        // play가 실제 있는 행만 단조 기준으로 (null 행을 0으로 치면 어제 실측이 있어도 기준이 0이 됨)
        if (!lastKnownPlay.has(s.post_id) && s.play_count != null) lastKnownPlay.set(s.post_id, s.play_count);
        if (!lastMeasuredAt.has(s.post_id)) lastMeasuredAt.set(s.post_id, s.measured_at);
      }
    };
    for (let c = 0; c < batchIds.length; c += ID_CHUNK) {
      const idsChunk = batchIds.slice(c, c + ID_CHUNK);
      for (let from = 0; ; from += PAGE) {
        const { data: page } = await supabase
          .from('post_daily_stats')
          .select('post_id, play_count, measured_at')
          .in('post_id', idsChunk)
          // 오늘(자정 GHA 수집분) 포함 — 낮 수집이 아침 실측보다 낮은 값으로 당일 행을 되덮는 것 방지
          .lte('measured_at', today)
          .order('measured_at', { ascending: false })
          .range(from, from + PAGE - 1);
        collectPrev(page as PrevRow[] | null);
        if (!page || page.length < PAGE) break;
      }
    }
  }

  const ENDED_DAYS = 7;
  const rows = [];
  const pendingUpdates: { id: string; updates: Record<string, unknown> }[] = [];
  const endedUpdates: { id: string; ended_at: string }[] = [];
  let skipped = 0;
  for (const post of eligiblePosts) {
    const key = statsKey(post.url);
    const s = statsByKey[key];

    if (!s) {
      // 🛑 미반환 → 자동 종료 감지: 이전 실데이터(>0) 있고 ENDED_DAYS 경과 + 아직 종료 안 됨
      // 단, '위성채널'·'온드미디어' 프로젝트 소재는 자동 종료 제외(요청)
      const pn = (post.project_name as string | null) ?? "";
      if (!post.ended_at && !pn.includes("위성채널") && !pn.includes("온드미디어")) {
        const prevPlay = lastKnownPlay.get(post.id);
        const last = lastMeasuredAt.get(post.id);
        if (prevPlay && prevPlay > 0 && last) {
          const gapDays = Math.floor((Date.parse(today) - Date.parse(last)) / 86400000);
          if (gapDays >= ENDED_DAYS) endedUpdates.push({ id: post.id, ended_at: last });
        }
      }
      continue;
    }

    if (post.posted_at && s.posted_at) {
      const postDate = Date.parse(`${String(post.posted_at).slice(0, 10)}T00:00:00Z`);
      const statDate = Date.parse(`${String(s.posted_at).slice(0, 10)}T00:00:00Z`);
      const gapDays = Math.abs((statDate - postDate) / 86400000);
      if (Number.isFinite(gapDays) && gapDays > 1) { skipped++; continue; }
    }

    const updates: Record<string, unknown> = {};
    if (!post.posted_at && s.posted_at) updates.posted_at = s.posted_at;
    if (!post.account_name && s.account_name) updates.account_name = s.account_name;
    if (!post.content_summary && s.content_summary) updates.content_summary = s.content_summary;
    if (!post.influencer_id && s.owner_username) {
      const profileUrl = `https://www.instagram.com/${s.owner_username}/`;
      const infId = infUrlMap.get(profileUrl);
      if (infId) updates.influencer_id = infId;
    }
    if (Object.keys(updates).length > 0) {
      pendingUpdates.push({ id: post.id, updates });
    }

    // 🛡️ 단조 보정: 신규 조회수가 없거나(미반환) 0(접근불가·글리치, '수집 실패 ≠ 0' 원칙 — run_monitoring과 동일)
    //    또는 직전값(당일 포함)보다 작으면(수집 오류) 저장 스킵 → 기존값 유지
    const newPlay = s.play_count;
    const prevPlay = lastKnownPlay.get(post.id);
    if (newPlay == null || Number(newPlay) <= 0) { skipped++; continue; }
    if (prevPlay != null && Number(newPlay) < prevPlay) { skipped++; continue; }

    rows.push({ post_id: post.id, measured_at: today, play_count: newPlay, likes_count: s.likes_count, comments_count: s.comments_count });
  }

  // N+1 방지: 병렬 업데이트
  if (pendingUpdates.length > 0) {
    await Promise.all(
      pendingUpdates.map(({ id, updates: upd }) =>
        supabase.from('sponsored_posts').update(upd).eq('id', id)
      )
    );
  }
  if (endedUpdates.length > 0) {
    await Promise.all(
      endedUpdates.map(({ id, ended_at }) =>
        supabase.from('sponsored_posts').update({ ended_at }).eq('id', id)
      )
    );
  }
  if (rows.length > 0) {
    await supabase.from('post_daily_stats').upsert(rows, { onConflict: 'post_id,measured_at' });
  }
  await supabase.from('jobs').update({ status: 'done', payload: { saved: rows.length, skipped, ended: endedUpdates.length } }).eq('id', jobId);

  // 자동 수집(크론, user_email 없음)만 Slack 통지 — 수동 버튼 노이즈 방지
  const { data: jobRow } = await supabase.from('jobs').select('user_email').eq('id', jobId).single();
  if (!(jobRow as { user_email: string | null } | null)?.user_email) {
    await notifyJob('협찬 모니터링', 'ok', `${rows.length}건 적재${endedUpdates.length ? `, 종료 ${endedUpdates.length}건` : ''}${skipped ? `, 스킵 ${skipped}` : ''}`);
  }
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
      if (isBrandAccount(username, item.ownerFullName as string)) continue; // 브랜드/공식 계정 제외

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
        sample_thumbnail_url: (item.displayUrl as string) || null,
        post_type: '릴스',
        post_uploaded_at: postUploadedAt,
      };
    }
  } else if (platform === 'youtube') {
    for (const item of items) {
      const rawChannelUrl = (item.channelUrl || item.authorUrl || (item.channelId ? `https://www.youtube.com/channel/${item.channelId}` : null)) as string;
      const channelName = (item.channelName || item.channelTitle || item.author) as string;
      if (!rawChannelUrl || !channelName) continue;
      if (isBrandAccount(channelName, rawChannelUrl)) continue; // 브랜드/공식 계정 제외

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

  // insert 실패를 모아 마지막에 job 상태를 판정 (실패를 'done'으로 숨기지 않기 위함)
  const insertErrors: string[] = [];

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
    // normalizeInstagramUrl이 null을 반환하면(릴스/포스트 URL) raw URL 그대로 사용
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
      if (posts.length === 0) return;

      // 릴스/포스트 URL로 저장된 경우, 실제 프로필 URL로 업데이트
      const ownerUsername = (posts[0]?.ownerUsername as string) || '';
      if (ownerUsername && url.match(/\/(reels?|p|tv)\//)) {
        const profileUrl = `https://www.instagram.com/${ownerUsername}/`;
        await supabase.from('influencers').update({ url: profileUrl }).eq('id', infId);
      }

      const profile = {
        username: (posts[0]?.ownerUsername as string) || '',
        // Apify 응답 필드명: ownerFollowersCount 또는 followersCount
        followers: (posts[0]?.ownerFollowersCount as number) || (posts[0]?.followersCount as number) || 0,
      };
      const metrics = calcMetrics(profile, posts);
      const typeMetrics = calcTypeMetrics(profile, posts, 'instagram');
      const { result: resultStatus, details } = evaluateCriteria(criteria, metrics);

      const { error: metricsErr } = await supabase.from('screening_metrics').insert({
        influencer_id: infId,
        ...metrics,
        criteria_snapshot: { result: resultStatus, details },
        type_metrics: Object.keys(typeMetrics).length ? typeMetrics : null,
      });
      if (metricsErr) {
        insertErrors.push(metricsErr.message);
        return;
      }

      // 채널명·캡션·썸네일 실제 데이터로 업데이트
      const realName = (posts[0]?.ownerFullName as string) || (posts[0]?.ownerUsername as string) || null;
      // 썸네일 이미지(릴스 커버/이미지)는 별도 필드에 저장 — sample_post_url(게시물 permalink, 리스트업이 저장한 매칭 게시물)은 덮지 않음
      const sampleThumb = (posts[0]?.thumbnailUrl as string) || (posts[0]?.displayUrl as string) || null;
      const caption = (posts[0]?.caption as string)?.slice(0, 300) || null;
      const rawTs = posts[0]?.timestamp || posts[0]?.takenAtTimestamp;
      const postUploadedAt = typeof rawTs === 'number'
        ? new Date((rawTs as number) * 1000).toISOString()
        : (rawTs as string) || null;
      const infUpdate: Record<string, unknown> = {};
      if (realName) infUpdate.name = realName;
      if (sampleThumb) infUpdate.sample_thumbnail_url = sampleThumb;
      if (caption) infUpdate.content_summary = caption;
      if (postUploadedAt) infUpdate.post_uploaded_at = postUploadedAt;
      // 브랜드 공식(인증/파란체크) 계정은 후보에서 제외 — 자동 '탈락'
      const isVerified = posts.some(p => p.verified === true);
      if (isVerified) infUpdate.status = 'reject';
      else if (resultStatus === 'pass' || resultStatus === 'reject') infUpdate.status = resultStatus;
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

    if (posts.length === 0) {
      await supabase.from('jobs').update({ status: 'done' }).eq('id', jobId);
      return;
    }

    const profile = { followers: followerCount };
    const metrics = calcMetrics(profile, posts as Record<string, unknown>[]);
    const typeMetrics = calcTypeMetrics(profile, posts as Record<string, unknown>[], 'youtube');
    const { result: resultStatus, details } = evaluateCriteria(criteria, metrics);

    const { error: ytMetricsErr } = await supabase.from('screening_metrics').insert({
      influencer_id: influencer.id,
      ...metrics,
      criteria_snapshot: { result: resultStatus, details },
      type_metrics: Object.keys(typeMetrics).length ? typeMetrics : null,
    });
    if (ytMetricsErr) {
      await supabase.from('jobs').update({ status: 'failed', error: `screening_metrics insert 오류: ${ytMetricsErr.message}` }).eq('id', jobId);
      return;
    }

    // 채널명·캡션·썸네일 실제 데이터로 업데이트
    const firstItem = items[0];
    const realName = (firstItem?.channelName || firstItem?.channelTitle || firstItem?.author) as string | null || null;
    const caption = (firstItem?.title as string)?.slice(0, 300) || null;
    const ytUpdate: Record<string, unknown> = {};
    if (realName) ytUpdate.name = realName;
    // sample_post_url(리스트업이 저장한 매칭 영상)은 덮지 않음
    if (caption) ytUpdate.content_summary = caption;
    if (resultStatus === 'pass' || resultStatus === 'reject') ytUpdate.status = resultStatus;
    if (Object.keys(ytUpdate).length > 0) {
      await supabase.from('influencers').update(ytUpdate).eq('id', influencer.id);
    }
  }

  if (insertErrors.length > 0) {
    await supabase.from('jobs').update({ status: 'failed', error: `screening_metrics insert 오류: ${insertErrors.join(' | ')}` }).eq('id', jobId);
  } else {
    await supabase.from('jobs').update({ status: 'done' }).eq('id', jobId);
  }
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

const ORGANIC_MIN_FOLLOWERS = 500_000;  // 50만 이상 인플루언서
const ORGANIC_MIN_VIEWS = 500_000;      // 50만 이상 뷰
const CELEBRITY_MIN_FOLLOWERS = 1_000_000;  // 100만+ = 아이돌/연예인으로 간주
const CELEBRITY_KEYWORDS = ['연예인', '아이돌', '배우', '가수', '탤런트', '방송인', '모델', '셀럽', '연예'];

function isCelebrity(username: string, followers: number, bio: string = ''): boolean {
  // 100만+ 팔로워 = 아이돌/연예인으로 간주
  if (followers >= CELEBRITY_MIN_FOLLOWERS) return true;

  // 또는 계정명/소개에 연예인 키워드 포함
  const text = (username + ' ' + bio).toLowerCase();
  return CELEBRITY_KEYWORDS.some(k => text.includes(k));
}

// Helper: 날짜 파싱 (다양한 형식 지원)
function parseDate(rawTs: unknown): string | null {
  if (!rawTs) return null;
  if (typeof rawTs === 'number') {
    return new Date(rawTs * 1000).toISOString().slice(0, 10);
  }
  if (typeof rawTs === 'string') {
    return rawTs.slice(0, 10);
  }
  return null;
}

// Helper: 공통 처리 로직
function buildRow(item: Record<string, unknown>, platform: string, url: string, overrides?: Partial<Record<string, unknown>>) {
  return {
    url,
    account_name: overrides?.account_name || null,
    platform,
    content_summary: overrides?.content_summary || null,
    uploaded_at: overrides?.uploaded_at || null,
    view_count: overrides?.view_count || null,
    source: 'apify',
    ...overrides,
  };
}

async function handleOrganic(supabase: ReturnType<typeof getServerSupabase>, jobId: string, items: Record<string, unknown>[], platform: string) {
  const rows: Record<string, unknown>[] = [];
  let collectedCount = 0;

  console.log(`[LOG] ${platform.toUpperCase()} 처리 시작: ${items.length}개`);

  for (const item of items) {
    // 공통 필터: 광고 확인
    if (isAd(item)) continue;

    let url: string | null = null;
    let viewCount = 0;
    let accountName: string | null = null;
    let contentSummary: string | null = null;
    let uploadedAt: string | null = null;

    try {
      // 플랫폼별 처리
      if (platform === 'tiktok') {
        url = (item.webVideoUrl || item.url) as string;
        if (!url) continue;
        viewCount = (item.playCount || item.plays || 0) as number;
        if (viewCount < ORGANIC_MIN_VIEWS) continue;
        accountName = (item.authorMeta as { name?: string } | undefined)?.name || (item.author as string) || null;
        contentSummary = (item.text as string)?.slice(0, 300) || null;
        uploadedAt = parseDate(item.createTime || item.createTimeISO);

      } else if (platform === 'twitter') {
        url = (item.url || item.tweetUrl) as string;
        if (!url) continue;
        viewCount = (item.viewCount || item.views || 0) as number;
        if (viewCount < ORGANIC_MIN_VIEWS) continue;
        accountName = (item.author as { userName?: string } | undefined)?.userName || (item.username as string) || null;
        contentSummary = ((item.fullText || item.text) as string)?.slice(0, 300) || null;
        uploadedAt = parseDate(item.createdAt || item.created_at);

      } else if (platform === 'blog') {
        url = (item.url || item.link) as string;
        if (!url) continue;
        viewCount = (item.viewCount || item.views || item.readCount || 0) as number;
        accountName = (item.author || item.blogName) as string || null;
        contentSummary = ((item.title || item.description) as string)?.slice(0, 300) || null;
        uploadedAt = parseDate(item.date || item.publishedAt);

      } else if (platform === 'threads') {
        url = (item.url || item.permalink) as string;
        if (!url) continue;
        viewCount = (item.viewCount || item.views || 0) as number;
        const likeCount = (item.likeCount || item.likes || 0) as number;
        if (viewCount < 100_000 && likeCount < 10_000) continue;
        accountName = (item.username || item.ownerUsername) as string || null;
        contentSummary = ((item.caption || item.text) as string)?.slice(0, 300) || null;
        uploadedAt = parseDate(item.takenAt || item.timestamp || item.createdAt);
        viewCount = viewCount || likeCount;

      } else if (platform === 'youtube') {
        const rawUrl = item.url as string;
        if (!rawUrl || !rawUrl.includes('/shorts/')) continue;

        try {
          const u = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
          url = `https://www.youtube.com${u.pathname}`;
        } catch {
          continue;
        }

        const title = (item.title as string) || '';
        const description = ((item.description || item.details) as string) || '';
        const textContent = (title + ' ' + description).toLowerCase();

        // YouTube만 키워드 필터 적용
        if (!textContent.includes('라라스윗') && !textContent.includes('lalasweet')) {
          continue;
        }

        viewCount = (item.viewCount || item.views || 0) as number;
        if (viewCount < 10_000) continue;

        accountName = (item.channelName || item.channelTitle || item.author) as string || null;
        contentSummary = title || null;
        uploadedAt = parseDate(item.date || item.publishedAt || item.uploadDate);
      }

      // 저장
      if (url) {
        rows.push(buildRow(item, platform === 'twitter' ? 'x' : platform, url, {
          account_name: accountName,
          content_summary: contentSummary,
          uploaded_at: uploadedAt,
          view_count: viewCount || null,
        }));
        collectedCount++;
      }
    } catch (e) {
      console.error(`[ERROR] ${platform} 처리 실패:`, e);
      continue;
    }
  }

  console.log(`[LOG] ${platform.toUpperCase()} 수집 완료: ${collectedCount}건 저장`);

  if (rows.length > 0) {
    await supabase.from('organic_mentions').upsert(rows, { onConflict: 'url', ignoreDuplicates: false });
  }
  await supabase.from('jobs').update({ status: 'done', payload: { saved: rows.length } }).eq('id', jobId);
}
