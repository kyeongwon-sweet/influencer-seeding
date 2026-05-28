from __future__ import annotations
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from instagram_fetcher import fetch_all, detect_platform
from metrics import calc_all_metrics, calc_type_metrics
from db import get_client


def _safe(v):
    if v == "-":
        return None
    if v == "O":
        return True
    if v == "X":
        return False
    return v


def _map_metrics(metrics: dict) -> dict:
    return {
        "followers":               _safe(metrics.get("팔로워 수")),
        "avg_views_per_follower":  _safe(metrics.get("팔로워 대비 평균 조회수")),
        "count_1m_view":           _safe(metrics.get("100만뷰 이상 개수")),
        "total_posts":             _safe(metrics.get("총 게시물")),
        "general_posts":           _safe(metrics.get("일반 게시물")),
        "ad_posts":                _safe(metrics.get("광고 게시물")),
        "total_avg_view_count":    _safe(metrics.get("총 평균 도달수")),
        "general_avg_view_count":  _safe(metrics.get("일반 평균 도달수")),
        "ad_avg_view_count":       _safe(metrics.get("광고 평균 도달수")),
        "total_avg_play_count":    _safe(metrics.get("총 평균 조회수")),
        "general_avg_play_count":  _safe(metrics.get("일반 평균 조회수")),
        "ad_avg_play_count":       _safe(metrics.get("광고 평균 조회수")),
        "total_like_ratio":        _safe(metrics.get("총 Like 비율")),
        "general_like_ratio":      _safe(metrics.get("일반 Like 비율")),
        "ad_like_ratio":           _safe(metrics.get("광고 Like 비율")),
        "total_comment_ratio":     _safe(metrics.get("총 Comments 비율")),
        "general_comment_ratio":   _safe(metrics.get("일반 Comments 비율")),
        "ad_comment_ratio":        _safe(metrics.get("광고 Comments 비율")),
        "top_ad_play_count":       _safe(metrics.get("광고 최고 조회수")),
        "top_ad_post_url":         _safe(metrics.get("광고 최고 게시물 URL")),
        "avg_video_duration":      _safe(metrics.get("평균 영상 길이(초)")),
    }


def _fetch_criteria(db) -> dict:
    """현재 활성 통과 기준 조회 (updated_at 최신 행)."""
    result = db.table("screening_criteria").select("*").order("updated_at", desc=True).limit(1).execute()
    return result.data[0] if result.data else {}


def _evaluate_criteria(criteria: dict, mapped: dict) -> tuple[str, list]:
    """지표와 기준을 비교해 result("pass"/"reject"/"no_criteria")와 상세 목록 반환.
    criteria의 값이 None이면 해당 조건은 건너뜀."""
    checks = [
        ("팔로워 수",            "min_followers",          mapped.get("followers"),            "≥"),
        ("100만뷰 이상 개수",    "min_1m_count",           mapped.get("count_1m_view"),        "≥"),
        ("팔로워 대비 평균 조회수", "min_views_per_follower", mapped.get("avg_views_per_follower"), "≥"),
        ("총 평균 조회수",        "min_avg_views",          mapped.get("total_avg_play_count"), "≥"),
    ]

    # 광고 비율 계산
    total_posts = mapped.get("total_posts")
    ad_posts = mapped.get("ad_posts")
    ad_ratio = round(ad_posts / total_posts * 100, 1) if total_posts and ad_posts is not None else None
    checks.append(("광고 게시물 비율(%)", "max_ad_ratio", ad_ratio, "≤"))

    # 활성 기준이 하나라도 있는지 확인
    active = [key for _, key, _, _ in checks if criteria.get(key) is not None]
    if not active:
        return "no_criteria", []

    details = []
    all_passed = True

    for label, key, value, op in checks:
        threshold = criteria.get(key)
        if threshold is None:
            continue
        if value is None:
            ok = False
        elif op == "≥":
            ok = value >= threshold
        else:  # ≤
            ok = value <= threshold
        details.append({"label": label, "op": op, "threshold": threshold, "value": value, "passed": ok})
        if not ok:
            all_passed = False

    return "pass" if all_passed else "reject", details


def run():
    payload = json.loads(os.environ.get("JOB_PAYLOAD", "{}"))
    job_id = payload.get("job_id")
    influencer_ids = payload.get("influencer_ids")

    db = get_client()

    if job_id:
        db.table("jobs").update({"status": "running"}).eq("id", job_id).execute()

    criteria = _fetch_criteria(db)
    print(f"통과 기준: {criteria}")

    # 대상 인플루언서 조회 (지정 ID or 지표 없는 전체)
    if influencer_ids:
        result = db.table("influencers").select("id, name, url, platform").in_("id", influencer_ids).execute()
    else:
        screened = [r["influencer_id"] for r in db.table("screening_metrics").select("influencer_id").execute().data]
        q = db.table("influencers").select("id, name, url, platform")
        if screened:
            q = q.not_.in_("id", screened)
        result = q.execute()

    influencers = result.data

    if not influencers:
        print("스크리닝할 후보가 없습니다.")
        if job_id:
            db.table("jobs").update({"status": "done", "payload": {"screened": 0}}).eq("id", job_id).execute()
        return

    print(f"\n미처리 {len(influencers)}명 발견\n")

    pending = [{"name": inf["name"], "url": inf["url"], "row": inf["id"], "id": inf["id"]} for inf in influencers]
    results = fetch_all(pending)

    print("\n지표 산출 중...")
    screened = 0
    for r in results:
        try:
            metrics = calc_all_metrics(r["profile"], r["posts"])
            mapped = _map_metrics(metrics)
            result_status, details = _evaluate_criteria(criteria, mapped)

            criteria_snapshot = {"result": result_status, "details": details}

            platform = detect_platform(r["url"])
            type_metrics_raw = calc_type_metrics(r["profile"], r["posts"], platform)
            type_metrics = {k: _map_metrics(v) for k, v in type_metrics_raw.items()} or None

            db.table("screening_metrics").insert({
                "influencer_id": r["row"],
                **mapped,
                "criteria_snapshot": criteria_snapshot,
                "type_metrics": type_metrics,
            }).execute()

            # 통과 기준이 있으면 influencer 상태 자동 설정
            if result_status in ("pass", "reject"):
                db.table("influencers").update({"status": result_status}).eq("id", r["row"]).execute()

            screened += 1
            play_count = metrics.get("총 평균 조회수", "-")
            formatted = f"{play_count:,}" if isinstance(play_count, (int, float)) else play_count
            print(f"  {r['name']} → 완료 (총 평균 조회수 {formatted}, 기준 판정: {result_status})")
        except Exception as e:
            print(f"  {r['name']} → 오류: {e}")

    if job_id:
        db.table("jobs").update({"status": "done", "payload": {"screened": screened}}).eq("id", job_id).execute()

    print("\n완료!")


if __name__ == "__main__":
    run()
