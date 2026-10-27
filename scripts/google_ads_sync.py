#!/usr/bin/env python3
"""Google Ads(유튜브 광고) 광고그룹×일 성과를 읽어 ad_platform_daily 에 적재한다 — 읽기 전용 연동(2026-10-27).

범위(사용자 결정 2026-10-27): 바치케 = 광고그룹 이름에 'P바치'가 든 모든 광고그룹(캠페인 무관).
  지금 P바치 유튜브는 인지(Video, TrueView 타깃 CPV) 캠페인 2개뿐이고 전환 캠페인은 없다 — 생기면 같은 규칙으로 잡힌다.
지표: 비용(cost_micros/1e6, KRW)·노출·TrueView 조회수(광고 조회수 — 시트 '인지영상_YouTube 조회수'와 같은 정의,
  9/25~10/26 합계 대조: 비용 0.007%·노출 0.001%·조회 0.016% 차이).
날짜: segments.date = 계정 시간대. 계정이 Asia/Seoul 이 아니면 저장하지 않고 실패한다(KST 규칙).
조회했다는 사실은 ops_daily_runs(service=google_ads_sync:pbachi, run_date=그날)에 남겨, 행이 없는 날(=노출 없음, 확정 0)과
  조회 실패(빈 값)를 구분한다. 시트 수기값은 건드리지 않는다(병행 비교 단계).
공개 레포 — 로그에는 건수만 남기고 금액·지표 값은 찍지 않는다.

env: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN,
     GOOGLE_ADS_LOGIN_CUSTOMER_ID(MCC), GOOGLE_ADS_CUSTOMER_ID(광고 계정), GOOGLE_ADS_API_VERSION(기본 v25),
     SINCE/UNTIL(YYYY-MM-DD, 비우면 KST 어제부터 DAYS일, 기본 10 — 후행 보정 흡수), DRY_RUN("true"면 DB 미기록),
     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from kst_dates import kst_now, kst_today

PLATFORM = "google_ads"
PRODUCT = "P바치"
RUN_SERVICE = "google_ads_sync:pbachi"
EXPECTED_TZ = "Asia/Seoul"
API_BASE = "https://googleads.googleapis.com"
# API 버전에 따라 조회수 지표 이름이 다르다(video_trueview_views ↔ video_views). 인식되는 쪽을 쓴다.
VIEW_FIELDS = ("metrics.video_trueview_views", "metrics.video_views")


def is_product_ad_group(name: str | None, product: str = PRODUCT) -> bool:
    """광고그룹 이름에 제품 표시가 있나(공백·대소문자 무시) — 메타 isPbachiAd 와 같은 정규화."""
    return product.upper() in "".join(str(name or "").split()).upper()


def date_range(since: str | None, until: str | None, days: int, today_kst: str) -> tuple[str, str]:
    """SINCE/UNTIL 이 있으면 그대로, 없으면 KST 어제부터 days일."""
    if since and until:
        if since > until:
            raise ValueError(f"SINCE({since}) > UNTIL({until})")
        return since, until
    end = dt.date.fromisoformat(today_kst) - dt.timedelta(days=1)
    return (end - dt.timedelta(days=days - 1)).isoformat(), end.isoformat()


def each_date(since: str, until: str) -> list[str]:
    d, e = dt.date.fromisoformat(since), dt.date.fromisoformat(until)
    out = []
    while d <= e:
        out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


class GoogleAdsError(RuntimeError):
    def __init__(self, status: int, detail: str):
        super().__init__(f"Google Ads API {status}")
        self.status, self.detail = status, detail


class GoogleAds:
    def __init__(self, env=os.environ, opener=urllib.request.urlopen):
        need = ["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET",
                "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_LOGIN_CUSTOMER_ID", "GOOGLE_ADS_CUSTOMER_ID"]
        missing = [k for k in need if not (env.get(k) or "").strip()]
        if missing:
            raise RuntimeError(f"자격증명 미설정: {', '.join(missing)}")
        self.env, self.open = env, opener
        self.version = (env.get("GOOGLE_ADS_API_VERSION") or "v25").strip()
        self.login = "".join(c for c in env["GOOGLE_ADS_LOGIN_CUSTOMER_ID"] if c.isdigit())
        self.customer = "".join(c for c in env["GOOGLE_ADS_CUSTOMER_ID"] if c.isdigit())
        self._token = None

    def _json(self, req):
        try:
            with self.open(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise GoogleAdsError(e.code, e.read().decode(errors="replace")[:3000]) from None

    def token(self) -> str:
        if not self._token:
            body = urllib.parse.urlencode({
                "client_id": self.env["GOOGLE_ADS_CLIENT_ID"], "client_secret": self.env["GOOGLE_ADS_CLIENT_SECRET"],
                "refresh_token": self.env["GOOGLE_ADS_REFRESH_TOKEN"], "grant_type": "refresh_token",
            }).encode()
            d = self._json(urllib.request.Request("https://oauth2.googleapis.com/token", data=body))
            self._token = d.get("access_token") or ""
            if not self._token:
                raise RuntimeError("OAuth access_token 없음")
        return self._token

    def search(self, query: str) -> list[dict]:
        req = urllib.request.Request(
            f"{API_BASE}/{self.version}/customers/{self.customer}/googleAds:searchStream",
            data=json.dumps({"query": query}).encode(),
            headers={"Authorization": "Bearer " + self.token(), "developer-token": self.env["GOOGLE_ADS_DEVELOPER_TOKEN"],
                     "login-customer-id": self.login, "Content-Type": "application/json"})
        out = []
        for batch in self._json(req) or []:
            out.extend(batch.get("results") or [])
        return out


def account_time_zone(ads: GoogleAds) -> str:
    rows = ads.search("SELECT customer.id, customer.time_zone FROM customer")
    return (rows[0].get("customer") or {}).get("timeZone", "") if rows else ""


def fetch_ad_group_daily(ads: GoogleAds, since: str, until: str) -> tuple[list[dict], str | None]:
    """광고그룹×일 행. 조회수 지표 이름은 버전마다 달라 인식되는 것을 찾는다 — 둘 다 안 되면 views=None(빈 값)."""
    base = ["campaign.id", "campaign.name", "campaign.advertising_channel_type", "ad_group.id", "ad_group.name",
            "segments.date", "metrics.cost_micros", "metrics.impressions"]
    where = f"FROM ad_group WHERE segments.date BETWEEN '{since}' AND '{until}'"
    for vf in (*VIEW_FIELDS, None):
        fields = base + ([vf] if vf else [])
        try:
            return ads.search(f"SELECT {', '.join(fields)} {where}"), vf
        except GoogleAdsError as e:
            if vf and e.status == 400 and vf in e.detail:
                continue   # 이 버전에 없는 지표 이름 → 다음 후보
            raise
    raise RuntimeError("unreachable")


def to_rows(results: list[dict], view_field: str | None, account_id: str, fetched_at: str) -> list[dict]:
    """API 결과 → ad_platform_daily 행(제품 표시가 있는 광고그룹만)."""
    vkey = None
    if view_field:   # metrics.video_trueview_views → videoTrueviewViews (API JSON은 camelCase)
        parts = view_field.split(".")[1].split("_")
        vkey = parts[0] + "".join(p.title() for p in parts[1:])
    rows = []
    for r in results:
        ag, c, m = r.get("adGroup") or {}, r.get("campaign") or {}, r.get("metrics") or {}
        if not is_product_ad_group(ag.get("name")):
            continue
        views = m.get(vkey) if vkey else None
        rows.append({
            "platform": PLATFORM, "account_id": account_id,
            "campaign_id": str(c.get("id") or ""), "campaign_name": c.get("name"),
            "channel_type": c.get("advertisingChannelType"),
            "ad_group_id": str(ag.get("id") or ""), "ad_group_name": ag.get("name"),
            "date": (r.get("segments") or {}).get("date"),
            "cost_krw": round(int(m.get("costMicros") or 0) / 1_000_000, 2),
            "impressions": int(m.get("impressions") or 0),
            "views": (int(views) if views is not None else (0 if vkey else None)),
            "product": PRODUCT, "fetched_at": fetched_at,
        })
    bad = [x for x in rows if not x["ad_group_id"] or not x["date"]]
    if bad:
        raise RuntimeError(f"식별자 빠진 행 {len(bad)}건 — 저장 중단")
    return rows


def run_markers(dates: list[str], rows: list[dict], view_field: str | None, fetched_at: str) -> list[dict]:
    """조회 성공한 날마다 1행 — 그날 행이 없으면 '노출 없음(확정 0)', 마커가 없으면 '조회 안 됨(빈 값)'."""
    out = []
    for d in dates:
        day = [x for x in rows if x["date"] == d]
        out.append({"service": RUN_SERVICE, "run_date": d, "status": "done",
                    "payload": {"fetched_at": fetched_at, "ad_groups": len(day), "view_field": view_field}})
    return out


def main() -> int:
    dry = (os.getenv("DRY_RUN") or "false").lower() == "true"
    since, until = date_range(os.getenv("SINCE"), os.getenv("UNTIL"), int(os.getenv("DAYS") or 10), kst_today())
    print(f"[gads] 모드 {'DRY_RUN' if dry else 'APPLY'} / 기간 {since}~{until} / 제품 {PRODUCT}")
    ads = GoogleAds()
    tz = account_time_zone(ads)
    if tz != EXPECTED_TZ:
        print(f"[gads] ❌ 계정 시간대 {tz!r} ≠ {EXPECTED_TZ} — 날짜 기준이 달라 저장하지 않음")
        return 1
    results, vf = fetch_ad_group_daily(ads, since, until)
    fetched_at = kst_now().isoformat()
    rows = to_rows(results, vf, ads.customer, fetched_at)
    dates = each_date(since, until)
    markers = run_markers(dates, rows, vf, fetched_at)
    groups = len({x["ad_group_id"] for x in rows})
    print(f"[gads] API 행 {len(results)} → {PRODUCT} 광고그룹 {groups}개·{len(rows)}행 / 조회수 지표 {vf or '없음(빈 값)'}"
          f" / 노출 있는 날 {len({x['date'] for x in rows})}/{len(dates)}일")
    if vf is None:
        print("[gads] ⚠️ 조회수 지표를 이 API 버전에서 찾지 못함 — views는 빈 값으로 저장")
    if dry:
        return 0
    from db import get_client   # DRY_RUN 은 DB 없이 돈다
    sb = get_client()
    for i in range(0, len(rows), 500):
        sb.table("ad_platform_daily").upsert(rows[i:i + 500], on_conflict="platform,ad_group_id,date").execute()
    sb.table("ops_daily_runs").upsert(markers, on_conflict="service,run_date").execute()
    # 재조회로 저장 확인(건수만)
    got = (sb.table("ad_platform_daily").select("ad_group_id", count="exact")
           .eq("platform", PLATFORM).eq("product", PRODUCT).gte("date", since).lte("date", until).execute())
    ok = (got.count or 0) >= len(rows)
    print(f"[gads] 저장 {len(rows)}행 / 재조회 {got.count}행 {'✅' if ok else '⚠️ 불일치'} / 조회 마커 {len(markers)}일")
    return 0 if ok else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except GoogleAdsError as e:
        # 공개 로그 — 응답 본문(쿼리·계정 정보 포함 가능)은 앞부분만
        print(f"[gads] ❌ {e} {e.detail[:300]}")
        sys.exit(1)
