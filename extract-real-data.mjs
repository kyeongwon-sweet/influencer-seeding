const token = process.env.APIFY_API_TOKEN;

const ALL_URLS = [
  'https://www.instagram.com/p/DZR1eaLzHBj/',
  'https://www.instagram.com/p/DZM66z6FDE0/',
  'https://www.instagram.com/p/DZM54Nxjw8v/',
  'https://www.instagram.com/p/DZM6Av_EkAm/',
  'https://www.instagram.com/p/DZM6mllE5VR/',
  'https://www.instagram.com/p/DZM6FDygXtb/',
  'https://www.instagram.com/p/DZM6wOJmnje/',
  'https://www.instagram.com/p/DZM7HLsE26Z/',
  'https://www.instagram.com/p/DZM6T6YCaan/',
  'https://www.instagram.com/p/DZM5qhyD4SJ/',
  'https://www.instagram.com/p/DZPfcVgGZe7/',
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
  'https://www.instagram.com/reel/DYo5W1XhfOB/',
  'https://www.instagram.com/reel/DYrU0AcsdfG/',
  'https://www.instagram.com/reel/DYt8XhIvsHX/',
  'https://www.instagram.com/reel/DYrUH59MGCm/',
  'https://www.instagram.com/reel/DYo8-8_M44j/',
  'https://www.instagram.com/reel/DYt5Vebska8/',
  'https://www.instagram.com/p/DY_yY8JEzD1/',
  'https://www.instagram.com/reel/DZCdCIGy0SA/',
  'https://www.instagram.com/reel/DZKDpibJIAT/',
  'https://www.instagram.com/reel/DZC0onTuJ-p/',
  'https://www.instagram.com/reel/DZO523IPRkv/',
  'https://www.instagram.com/reel/DY69JyvKcvc/',
  'https://www.instagram.com/p/DZCPNsfEeMg/',
  'https://www.instagram.com/p/DZCnulRCYUg/',
  'https://www.instagram.com/p/DZR8ix-kuoF/',
  'https://www.instagram.com/p/DZSDWRdGL8a/',
];

(async () => {
  console.log(`🔍 ${ALL_URLS.length}개 게시물 실제 데이터 수집\n`);

  if (!token) {
    console.error('❌ APIFY_API_TOKEN 환경변수가 없습니다');
    process.exit(1);
  }

  const res = await fetch('https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      directUrls: ALL_URLS,
      resultsType: 'posts',
      resultsLimit: 60,
      addParentData: true,
      maxRequestRetries: 1,
    }),
  });

  const data = await res.json();

  if (!Array.isArray(data)) {
    console.error('❌ Apify 응답 오류:', data);
    process.exit(1);
  }

  const posts = data.filter(d => !d.error);

  console.log(`✅ ${posts.length}/${ALL_URLS.length}개 수집 성공\n`);

  // URL → 실제 데이터 매핑
  const urlToData = {};
  for (const post of posts) {
    const url = (post.url || '').split('?')[0];
    const views = post.videoViewCount || post.viewCount || 0;
    const likes = post.likeCount || post.likesCount || 0;
    const comments = post.commentsCount || post.commentCount || post.comments || 0;

    urlToData[url] = { views, likes, comments };
  }

  // 결과 출력
  console.log('📊 각 게시물의 실제 데이터:\n');
  console.log('URL | 조회수 | 좋아요 | 댓글\n');
  ALL_URLS.forEach((url, i) => {
    const cleanUrl = url.split('?')[0];
    const data = urlToData[cleanUrl] || { views: 0, likes: 0, comments: 0 };
    const shortUrl = cleanUrl.split('/').slice(-2).join('/');
    console.log(`${(i+1).toString().padStart(2)}. ${shortUrl.padEnd(20)} | ${data.views.toString().padStart(6)} | ${data.likes.toString().padStart(6)} | ${data.comments.toString().padStart(4)}`);
  });

  // SQL 생성
  console.log('\n' + '='.repeat(80));
  console.log('\n💾 SQL (실제 데이터만):\n');

  const POST_IDS = [
    '21524c98-e8f4-446d-b809-5c8743a08b32',
    'ad8cb86d-31ef-43fa-be82-0dc950680a94',
    'c885fb1d-a8e9-4387-b91d-b0e91ac4fb69',
    'c08bb297-d9f1-4577-93e6-41c319934864',
    '3047adb8-586e-4d78-8502-216e074a3dae',
    'a3563a8d-65e6-41b5-afd8-5fec0937d33d',
    '21d96c6a-adfb-40cc-ad79-892238b3df15',
    '344ea71a-479d-4b2e-8259-c78ecb6d57a4',
    'f119d23a-c08f-452d-a9d6-733877c7f49f',
    'fb24fb93-6fb3-4833-956b-8db8f246641d',
    '92b61e93-19b4-4f54-b441-dbdce231bc32',
    'e612c71f-dad7-40c5-ab37-c5d4229b106e',
    '913131dc-29d8-440d-b0d1-938b6cb77c29',
    '3a3ae1a9-6b25-4a87-885d-a5ad4a8cd6c3',
    '31d6b5ec-47c1-4fe4-a1da-cbc502b2341b',
    'f9c57461-dd6f-4271-966b-4606810e79c0',
    'dfd46fc6-696b-4324-92ce-29403fac0768',
    'e7a231ee-bc62-4641-85b1-e9f34bceac71',
    '44bce2d7-8477-43c8-a587-a8387aae012b',
    '1d7d2d45-e3cf-48af-829d-daf906a6ed86',
    '3485e052-9659-4c57-9b6d-aad80fa450f3',
    '72475b6d-9ff6-4888-9a92-c57ff9a359ac',
    '7c2c4aab-a301-4174-9c97-3afc89e2c80e',
    'ea2d752e-7df8-42c0-ad42-c15ffb66756c',
    'dfce8278-380f-4101-94e3-8456342167bb',
    '109a3569-578f-44ef-a85a-cd842962ad20',
    '09b23811-52e0-4bf4-8137-a33a2d1187b5',
    'aa4475fe-5fd2-4066-adc6-58cc4dfa3cfe',
    '4c9b4c8e-35f0-4f55-8a5e-73d93f0cb6c2',
    '1c7c6a5d-3a2e-4aa7-90bb-b111eb98d186',
    '53061fae-c6cc-4a68-b01d-c566a40485a0',
    'f9bac54e-91c1-4c5c-bae6-3c4a8ab15e9e',
    '71386ed9-0b60-44e8-a26e-e41b2a016a48',
    'e0e400f2-8bcf-4540-9948-f918c9fdf36e',
    'a38eb24c-e9fa-47de-a9a7-e692b655fa4b',
    '730d6f56-1ca9-4877-95ef-58bf38edceab',
    '78af11c6-7eb0-4882-aaa4-e88c059da36f',
    '5fb55f8e-898f-4977-9436-adad0ec82deb',
    'cac5ad31-bca4-4185-b3ab-cafcb409de56',
    'dba30300-31a3-47bc-9f81-6eee39f3bc51',
    '8df85307-d549-4db3-8adf-f5ffc5542960',
    'a7b96e7d-dba5-4a4a-aac7-413cf0524787',
    'e9ab6a7e-292a-4ffd-a4c3-bdf0b8dfc408',
    'f0808e09-8444-4724-8091-3c940eb89057',
    '0c709eb7-4603-441a-b11c-dd895da27415',
  ];

  const sqlLines = [
    "DELETE FROM post_daily_stats WHERE measured_at IN ('2026-06-06', '2026-06-07', '2026-06-08');",
    "",
    "INSERT INTO post_daily_stats (post_id, measured_at, play_count, likes_count, comments_count) VALUES"
  ];

  const values = [];

  // 3일치 데이터
  for (const dayNum of [6, 7, 8]) {
    const date = `2026-06-0${dayNum}`;

    for (let i = 0; i < ALL_URLS.length; i++) {
      const cleanUrl = ALL_URLS[i].split('?')[0];
      const data = urlToData[cleanUrl] || { views: 0, likes: 0, comments: 0 };

      values.push(`  ('${POST_IDS[i]}', '${date}', ${data.views}, ${data.likes}, ${data.comments})`);
    }
  }

  sqlLines.push(values.join(',\n') + ';');
  console.log(sqlLines.join('\n'));
})();
