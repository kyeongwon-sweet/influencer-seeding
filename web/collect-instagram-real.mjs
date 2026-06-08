#!/usr/bin/env node

const URLS = [
  'https://www.instagram.com/reel/DZM9dH9S8vl/',
  'https://www.instagram.com/p/DZR1eaLzHBj/',
  'https://www.instagram.com/p/DZM66z6FDE0/',
  'https://www.instagram.com/p/DZM54Nxjw8v/',
  'https://www.instagram.com/reel/DZM7UHYtH7d/',
  'https://www.instagram.com/reel/DZM7XajJaFm/',
  'https://www.instagram.com/p/DZM6Av_EkAm/',
  'https://www.instagram.com/p/DZM6mllE5VR/',
  'https://www.instagram.com/reel/DZM7aYHyNBz/',
  'https://www.instagram.com/p/DZM6FDygXtb/',
  'https://www.instagram.com/p/DZPfcVgGZe7/',
  'https://www.instagram.com/p/DYmXo1fD6ln/',
  'https://www.instagram.com/reel/DYhItMWyj8l/',
  'https://www.instagram.com/reel/DYmLqrhTaR9/',
  'https://www.instagram.com/reel/DYt423KzT3v/',
  'https://www.instagram.com/reel/DYhIYCwvYvB/',
  'https://www.instagram.com/reel/DYhJFJHIL1j/',
  'https://www.instagram.com/reel/DYo756ezS5Q/',
  'https://www.instagram.com/reel/DYW2smjRWHj/',
  'https://www.instagram.com/reel/DYhH8kZxzXN/',
  'https://www.instagram.com/reel/DYt46v_pYH4/',
  'https://www.instagram.com/reel/DYW79hwy3cR/',
  'https://www.instagram.com/reel/DYjnil9t-gp/',
  'https://www.instagram.com/reel/DYjtKiWvELs/',
  'https://www.instagram.com/reel/DYhHfwdu47s/',
  'https://www.instagram.com/reel/DYjnvrFTugH/',
  'https://www.instagram.com/reel/DYZTGerTDMu/',
  'https://www.instagram.com/reel/DYt5Z9AT31n/',
  'https://www.instagram.com/reel/DYrUknSTu3s/',
  'https://www.instagram.com/reel/DYo53WLhkNq/',
];

const apiToken = process.env.APIFY_API_TOKEN;
console.log('🔑 APIFY_API_TOKEN:', apiToken ? '✓' : '✗');

if (!apiToken) process.exit(1);

async function fetch_stats(url) {
  try {
    const clean = url.split('?')[0];
    const id = clean.split('/').filter(x => x).pop();
    process.stdout.write(`  ${id}... `);

    const res = await fetch('https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postUrls: [clean],
        resultsType: 'posts',
        resultsLimit: 1,
      }),
      timeout: 45000,
    });

    if (!res.ok) return null;
    const result = await res.json();
    const data = result.data || [];
    if (!data[0]) return null;

    const p = data[0];
    const v = p.videoViewCount || p.viewCount || 0;
    const l = p.likeCount || 0;
    const c = p.commentCount || 0;

    console.log(`✅ ${v.toLocaleString()}`);
    return { url: clean, views: v, likes: l, comments: c };
  } catch (e) {
    console.log(`❌`);
    return null;
  }
}

async function main() {
  console.log(`\n🚀 ${URLS.length}개 게시물 조회수 수집\n`);

  const results = [];
  for (let i = 0; i < URLS.length; i++) {
    process.stdout.write(`[${i + 1}/${URLS.length}] `);
    const s = await fetch_stats(URLS[i]);
    if (s) results.push(s);
    if (i < URLS.length - 1) await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n✅ ${results.length}/${URLS.length} 수집 완료\n`);
  console.log(JSON.stringify(results, null, 2));

  if (results.length > 0) {
    const total = results.reduce((sum, r) => sum + r.views, 0);
    const avg = Math.round(total / results.length);
    console.log(`\n📈 총 조회수: ${total.toLocaleString()} | 평균: ${avg.toLocaleString()}`);
  }
}

main().catch(console.error);
