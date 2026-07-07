from db import get_client
db = get_client()
for D in ["2026-07-05","2026-07-06"]:
    tot=0; st=0
    while True:
        r=db.table("post_daily_stats").select("increment").eq("measured_at",D).gt("increment",0).range(st,st+999).execute()
        rows=r.data or []; tot+=sum((x.get("increment") or 0) for x in rows)
        if len(rows)<1000: break
        st+=1000
    print(D, "저장 increment 합 =", f"{tot:,}")
