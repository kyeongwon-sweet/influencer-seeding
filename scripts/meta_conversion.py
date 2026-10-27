"""바치케 '전환 조회수' = 메타 광고 관리자 'P바치' 전환 광고 노출수(2026-10-27 사용자 결정).

정의(어떤 광고를 세는지)는 웹 web/lib/meta-pbachi.ts 한 곳에만 있다 — 여기선 라우트
/api/meta-ads-pbachi 응답의 conversion.impressions 를 읽기만 한다(토큰이 Vercel 에만 있어 라우트 경유).
리포트 생성기(notify_increments)와 사후 보정(patch_report_conversion)이 같이 쓴다 — 보정 워크플로는
requirements 를 설치하지 않으므로 표준 라이브러리만 쓴다.
"""
import json
import time
import urllib.parse
import urllib.request


def meta_conversion_views(payload):
    """라우트 응답 → 전환 노출수(int) 또는 None(값 없음).
    그날 계정 광고 행이 하나도 없으면(scanned=0) 0이 아니라 None — 메타 집계 전/조회 이상일 수 있다(빈 값≠0)."""
    if not isinstance(payload, dict) or payload.get("error"):
        return None
    conv = payload.get("conversion")
    if not isinstance(conv, dict) or not isinstance(payload.get("scanned"), int) or payload["scanned"] <= 0:
        return None
    v = conv.get("impressions")
    return round(v) if isinstance(v, (int, float)) else None


def fetch_meta_conversion(base, secret, date, attempts=3, wait=5):
    """라우트 호출(간헐 502 재시도). 끝내 실패하면 예외 — 호출부가 '미집계'/그 날짜 실패로 처리."""
    req = urllib.request.Request(
        f"{base.rstrip('/')}/api/meta-ads-pbachi?date={urllib.parse.quote(date)}",
        headers={"Authorization": "Bearer " + secret})
    for i in range(attempts):
        try:
            return meta_conversion_views(json.load(urllib.request.urlopen(req, timeout=60)))
        except Exception:
            if i == attempts - 1:
                raise
            time.sleep(wait * (i + 1))
