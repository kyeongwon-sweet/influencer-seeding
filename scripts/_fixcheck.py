# API의 count기반 페이지네이션을 (구:measured_at 단독) vs (신:measured_at+id)로 재현, 07-06 increment 합 비교.
from db import get_client
db = get_client()
PAGE=1000
cnt = db.table("post_daily_stats").select("post_id", count="exact", head=True).execute().count
pages = max(1, -(-cnt//PAGE))
print("total rows(count)=", cnt, "pages=", pages)

def run(order2=False):
    seen={}  # post_id,measured_at -> increment (dedup)
    dup=0
    for i in range(pages):
        q = db.table("post_daily_stats").select("post_id, measured_at, increment").order("measured_at", desc=True)
        if order2: q = q.order("id", desc=False)
        rows = q.range(i*PAGE, i*PAGE+PAGE-1).execute().data or []
        for r in rows:
            k=(r["post_id"], r["measured_at"])
            if k in seen: dup+=1
            seen[k]=r.get("increment") or 0
    inc0706 = sum(v for (p,d),v in seen.items() if d=="2026-07-06" and v>0)
    return len(seen), dup, inc0706

for label,o2 in [("구(measured_at 단독)",False),("신(measured_at+id)",True)]:
    uniq,dup,inc = run(o2)
    print(f"{label}: 유니크행={uniq} 중복수신={dup} | 07-06 increment합={inc:,}")
