from db import get_client
db=get_client()
# 대상 게시물: 이름으로 검색
names=["이나","오하루","백독기","뻑독기"]
posts=[]
off=0
while True:
    r=db.table("sponsored_posts").select("id,account_name,url,channel_type,ended_at").range(off,off+999).execute()
    rows=r.data or []
    for p in rows:
        nm=(p.get("account_name") or "")
        if any(n in nm for n in names) and "instagram.com" in (p.get("url") or ""):
            posts.append(p)
    if len(rows)<1000: break
    off+=1000
for p in posts:
    st=db.table("post_daily_stats").select("measured_at,play_count,increment,reach_count").eq("post_id",p["id"]).gte("measured_at","2026-06-28").order("measured_at").execute().data or []
    print(f"\n=== {p['account_name']} [{p.get('channel_type')}] ended={p.get('ended_at')} {p['url']} ===")
    for s in st:
        print(f"  {s['measured_at']}  play={s.get('play_count')}  inc={s.get('increment')}  reach={s.get('reach_count')}")
