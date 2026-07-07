from db import get_client
db = get_client()
# 종료 여부 맵
ended=set(); off=0
while True:
    r=db.table("sponsored_posts").select("id, ended_at").range(off,off+999).execute()
    rows=r.data or []
    for p in rows:
        if p.get("ended_at"): ended.add(p["id"])
    if len(rows)<1000: break
    off+=1000
for D in ["2026-07-06"]:
    tot=act=end=0; st=0
    while True:
        r=db.table("post_daily_stats").select("post_id, increment").eq("measured_at",D).gt("increment",0).range(st,st+999).execute()
        rows=r.data or []
        for x in rows:
            inc=x.get("increment") or 0; tot+=inc
            if x["post_id"] in ended: end+=inc
            else: act+=inc
        if len(rows)<1000: break
        st+=1000
    print(f"{D}: 전체 +{tot:,} | 활성만 +{act:,} | 종료분 +{end:,}")
