#!/usr/bin/env python3
"""patch_report_conversion.patch_text 단위 테스트 — 2026-10 전환 조회수 사후 보정 회귀 케이스.

배경: 10/1~10/11 리포트가 발송 시점에 시트 '전환 노출수' 칸이 비어 전환 조회수 없이 나갔다.
보정은 발송 당시 숫자를 건드리지 않고 전환 줄 삽입 + 총 증분 합산 + 목표% 재계산만 해야 한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from patch_report_conversion import patch_text  # noqa: E402

AD_SECTION = """• *인지 광고*  `CPV는 일일 기준`
    메타 *+212,173*  CPV 4.9원
    틱톡 *+15,783*  CPV 5.2원
    유튜브 *+144,255*  CPV 15.8원

"""

REPORT = (
    """:chart_with_upwards_trend: *쫀득바 조회수 일일 증분* `(2026-10-05)`
오늘 총 증분 *+658,089*
:dart: *일 190만 목표* 35% · 미달 -1,241,911
:black_medium_small_square: *제품별*  JD혼 +183K · JD멜 +57.5K · JD복 +45.4K

:black_medium_small_square: *채널분류별*

"""
    + AD_SECTION
    + """`CPV는 누적 기준 / 하이퍼링크 금일 채널별 BEST`

• <https://www.instagram.com/p/DdbCnMYS4SN/|협찬 (인플루언서)> *+240,943*  CPV 7.2원"""
)


def test_adds_line_total_and_goal_only():
    new, info = patch_text(REPORT, 39670)
    assert info["new_total"] == 697_759
    assert "오늘 총 증분 *+697,759*" in new
    assert "*일 190만 목표* 37% · 미달 -1,202,241" in new
    assert "    유튜브 *+144,255*  CPV 15.8원\n    전환 조회수 *+39,670*\n\n`CPV는 누적" in new
    # 나머지 줄은 발송 당시 그대로
    untouched = [ln for ln in REPORT.split("\n") if "총 증분" not in ln and "만 목표" not in ln]
    assert all(ln in new.split("\n") for ln in untouched)


def test_idempotent_when_line_exists():
    new, _ = patch_text(REPORT, 39670)
    again, reason = patch_text(new, 39670)
    assert again is None and "이미" in reason


def test_creates_section_when_report_had_no_ad_lines():
    no_ads = REPORT.replace(AD_SECTION, "")
    new, info = patch_text(no_ads, 1000)
    assert info["new_total"] == 659_089
    assert "• *인지 광고*  `CPV는 일일 기준`\n    전환 조회수 *+1,000*\n\n`CPV는 누적" in new


def test_goal_crossing_and_rounding():
    near = REPORT.replace("+658,089", "+1,880,000").replace("35% · 미달 -1,241,911", "99% · 미달 -20,000")
    new, info = patch_text(near, 30000.4)
    assert info["conv"] == 30000
    assert "*일 190만 목표* 101% · 달성 +10,000" in new


def test_zero_without_section_is_not_shown():
    new, reason = patch_text(REPORT.replace(AD_SECTION, ""), 0)
    assert new is None and "표시 안 함" in reason


def test_default_dates_use_kst_yesterday_backwards():
    import datetime as dt
    from patch_report_conversion import default_dates

    # 17:30 KST(08:30 UTC) 실행 → KST 어제(10/13)부터 5일
    assert default_dates(dt.datetime(2026, 10, 14, 8, 30), 5) == [
        "2026-10-13", "2026-10-12", "2026-10-11", "2026-10-10", "2026-10-09"]
    # UTC로는 아직 10/13이지만 KST는 10/14 01:00 → 어제는 10/13
    assert default_dates(dt.datetime(2026, 10, 13, 16, 0), 1) == ["2026-10-13"]


def test_find_report_reads_channel_history_once_for_many_dates(monkeypatch):
    import patch_report_conversion as prc

    page = {"ok": True, "messages": [
        {"ts": "2", "bot_id": "B", "text": ":chart: *쫀득바 조회수 일일 증분* `(2026-10-13)`\n오늘 총 증분 *+1*"},
        {"ts": "1", "bot_id": "B", "text": ":chart: *쫀득바 조회수 일일 증분* `(2026-10-12)`\n오늘 총 증분 *+1*"},
        {"ts": "0", "text": "사람이 쓴 `(2026-10-12)` 일일 증분 언급"},  # 봇 아님 → 제외
    ], "response_metadata": {"next_cursor": ""}}
    calls = []
    monkeypatch.setattr(prc, "_slack", lambda *a, **k: calls.append(a) or page)
    monkeypatch.setattr(prc, "_history", {"msgs": [], "cursor": None, "done": False, "pages": 0})

    assert [m["ts"] for m in prc.find_report("tok", "2026-10-13")] == ["2"]
    assert [m["ts"] for m in prc.find_report("tok", "2026-10-12")] == ["1"]
    assert prc.find_report("tok", "2026-10-01") == []
    assert len(calls) == 1


# ── 재발방지(2026-10-14): 발송 때 시트가 비면 notify가 '미입력' 줄을 남기고, 보정이 그 줄을 값으로 바꾼다 ──

def test_notify_conversion_line_states():
    from notify_increments import CONV_PENDING_LINE, conversion_line

    assert conversion_line({"views": 39670}) == "    전환 조회수 *+39,670*"
    assert conversion_line({"views": 0}) == "    전환 조회수 *+0*"        # 0은 명시값 → 그대로 표시
    assert conversion_line({"views": 1234.6}) == "    전환 조회수 *+1,235*"
    assert conversion_line({"views": None}) == CONV_PENDING_LINE          # 빈칸 → 숨기지 않고 미입력
    assert conversion_line({}) == CONV_PENDING_LINE
    assert conversion_line(None) is None                                 # 구버전 라우트 → 생략


def test_patch_replaces_pending_line_in_place():
    from notify_increments import CONV_PENDING_LINE

    pending = REPORT.replace("    유튜브 *+144,255*  CPV 15.8원\n",
                             "    유튜브 *+144,255*  CPV 15.8원\n" + CONV_PENDING_LINE + "\n")
    new, info = patch_text(pending, 39670)
    assert info["new_total"] == 697_759
    assert CONV_PENDING_LINE not in new
    assert "    유튜브 *+144,255*  CPV 15.8원\n    전환 조회수 *+39,670*\n\n`CPV는 누적" in new
    assert new.count("전환 조회수") == 1


def test_patch_zero_keeps_totals_and_still_applies():
    from notify_increments import CONV_PENDING_LINE

    # 미입력 → 0 입력: 줄만 +0으로, 총 증분·목표는 그대로(예전 가드는 '2줄 변경'을 강제해 0을 거부했음)
    pending = REPORT.replace("    유튜브 *+144,255*  CPV 15.8원\n",
                             "    유튜브 *+144,255*  CPV 15.8원\n" + CONV_PENDING_LINE + "\n")
    new, info = patch_text(pending, 0)
    assert info["new_total"] == 658_089 and "    전환 조회수 *+0*" in new
    assert "*일 190만 목표* 35% · 미달 -1,241,911" in new
    # 섹션은 있는데 전환 줄이 아예 없던 옛 발송본도 0 보정 가능
    new2, info2 = patch_text(REPORT, 0)
    assert info2["new_total"] == 658_089 and "    전환 조회수 *+0*" in new2


def test_pending_line_is_not_mistaken_for_value():
    from notify_increments import CONV_PENDING_LINE

    pending = REPORT.replace("    유튜브 *+144,255*  CPV 15.8원\n",
                             "    유튜브 *+144,255*  CPV 15.8원\n" + CONV_PENDING_LINE + "\n")
    new, reason = patch_text(pending, 100)
    assert new is not None, reason   # '이미 있음'으로 건너뛰면 안 됨


def test_fetch_conversion_retries_transient_502(monkeypatch):
    import io
    import json as _json
    import urllib.error
    import patch_report_conversion as prc

    monkeypatch.setenv("APP_URL", "https://x.example")
    monkeypatch.setenv("CRON_SECRET", "s")
    monkeypatch.setattr(prc.time, "sleep", lambda s: None)
    calls = {"n": 0}

    def fake_urlopen(req, timeout=0):
        calls["n"] += 1
        if calls["n"] < 3:
            raise urllib.error.HTTPError(req.full_url, 502, "Bad Gateway", {}, None)
        return io.BytesIO(_json.dumps({"found": True, "conversion": {"views": 7}}).encode())

    monkeypatch.setattr(prc.urllib.request, "urlopen", fake_urlopen)
    assert prc.fetch_conversion("2026-09-21") == 7 and calls["n"] == 3


# ── 2026-10-27 바치케: 목표 줄 없는 리포트·제품 구분 ──

BACHI_REPORT = REPORT.replace("쫀득바", "바치케").replace(":dart: *일 190만 목표* 35% · 미달 -1,241,911\n", "")


def test_patch_without_goal_line():
    assert "만 목표" not in BACHI_REPORT
    new, info = patch_text(BACHI_REPORT, 97539)
    assert new is not None, info
    assert info["new_total"] == 658_089 + 97_539 and info["pct"] is None
    assert "오늘 총 증분 *+755,628*" in new and "만 목표" not in new


def test_products_match_notify_profiles():
    """이 스크립트(의존성 없이 도는 워크플로)의 제품표가 리포트 생성기와 어긋나면 엉뚱한 탭·제목을 고친다."""
    import patch_report_conversion as prc
    from notify_increments import PRODUCT_PROFILES
    assert set(prc.PRODUCTS) == set(PRODUCT_PROFILES)
    for k, p in PRODUCT_PROFILES.items():
        assert prc.PRODUCTS[k] == {"title": p["title"], "tab": p["ads_tab"], "conv": p["conv_source"]}, k


def test_find_report_is_scoped_to_product(monkeypatch):
    import patch_report_conversion as prc
    page = {"ok": True, "messages": [
        {"ts": "2", "bot_id": "B", "text": "📈 *바치케 조회수 일일 증분* `(2026-10-26)`\n오늘 총 증분 *+1*"},
        {"ts": "1", "bot_id": "B", "text": "📈 *쫀득바 조회수 일일 증분* `(2026-10-26)`\n오늘 총 증분 *+1*"},
    ], "response_metadata": {"next_cursor": ""}}
    monkeypatch.setattr(prc, "_slack", lambda *a, **k: page)
    for product, want in (("jd", ["1"]), ("pbachi", ["2"])):
        monkeypatch.setattr(prc, "PRODUCT", product)
        monkeypatch.setattr(prc, "_history", {"msgs": [], "cursor": None, "done": False, "pages": 0})
        assert [m["ts"] for m in prc.find_report("tok", "2026-10-26")] == want, product


def test_notify_profile_product_match():
    from notify_increments import PRODUCT_PROFILES
    jd, pb = PRODUCT_PROFILES["jd"]["match"], PRODUCT_PROFILES["pbachi"]["match"]
    assert jd("JD혼") and jd("jd멜") and not jd("P바치") and not jd(None)
    assert pb("P바치") and pb(" P 바치 ") and not pb("P바") and not pb("P망") and not pb("JD혼") and not pb(None)


# ── 2026-10-27 바치케 전환 = 메타 광고 관리자 P바치 전환 광고 노출수, 7일 뒤 확정값 덮어쓰기 ──

BACHI_WITH_CONV = BACHI_REPORT.replace(
    "    유튜브 *+144,255*  CPV 15.8원\n", "    유튜브 *+144,255*  CPV 15.8원\n    전환 조회수 *+97,549*\n"
).replace("오늘 총 증분 *+658,089*", "오늘 총 증분 *+755,638*")


def test_replace_conversion_value_adjusts_total_by_delta_only():
    from patch_report_conversion import replace_conversion_value
    new, info = replace_conversion_value(BACHI_WITH_CONV, 81038)
    assert info["old_conv"] == 97_549 and info["new_total"] == 755_638 - 97_549 + 81_038
    assert "    전환 조회수 *+81,038*" in new and "오늘 총 증분 *+739,127*" in new
    changed = [ln for ln in BACHI_WITH_CONV.split("\n") if ln not in new.split("\n")]
    assert len(changed) == 2   # 전환 줄·총 증분 줄만
    again, reason = replace_conversion_value(new, 81038)
    assert again is None and "같음" in reason


def test_replace_conversion_value_recomputes_goal():
    from patch_report_conversion import replace_conversion_value
    jd = REPORT.replace("    유튜브 *+144,255*  CPV 15.8원\n", "    유튜브 *+144,255*  CPV 15.8원\n    전환 조회수 *+1,000*\n")
    new, info = replace_conversion_value(jd, 11000)
    assert info["new_total"] == 668_089 and "*일 190만 목표* 35% · 미달 -1,231,911" in new


def test_meta_conversion_views_blank_is_not_zero():
    from meta_conversion import meta_conversion_views as v
    assert v({"scanned": 40, "conversion": {"impressions": 81038, "spend": 1, "ads": 3}}) == 81038
    assert v({"scanned": 40, "conversion": {"impressions": 0, "spend": 0, "ads": 0}}) == 0   # 계정은 돌았는데 P바치 전환 없음
    assert v({"scanned": 0, "conversion": {"impressions": 0}}) is None    # 그날 계정 행 0 = 집계 전/이상 → 빈 값
    assert v({"error": "Meta Graph 오류"}) is None
    assert v({"scanned": 5}) is None                                        # 구버전 라우트(conversion 없음)
    assert v(None) is None


def test_notify_meta_pending_line_is_patchable():
    from notify_increments import CONV_PENDING_LINE_META, conversion_line
    assert conversion_line({"views": None, "source": "meta"}) == CONV_PENDING_LINE_META
    assert conversion_line({"views": 5, "source": "meta"}) == "    전환 조회수 *+5*"
    pending = BACHI_REPORT.replace("    유튜브 *+144,255*  CPV 15.8원\n",
                                   "    유튜브 *+144,255*  CPV 15.8원\n" + CONV_PENDING_LINE_META + "\n")
    new, info = patch_text(pending, 81038)
    assert new is not None, info
    assert CONV_PENDING_LINE_META not in new and "    전환 조회수 *+81,038*" in new


def test_notify_meta_conversion_replaces_sheet_value(monkeypatch):
    """바치케: 시트 전환 값은 버리고 메타 값 / 시트 행이 없어도 전환은 남고 / 메타 실패면 '미집계'."""
    import io
    import json as _json
    import urllib.error
    import notify_increments as ni

    monkeypatch.setenv("APP_URL", "https://x.example")
    monkeypatch.setenv("CRON_SECRET", "s")
    monkeypatch.setattr(ni, "PROFILE", ni.PRODUCT_PROFILES["pbachi"])
    import meta_conversion
    monkeypatch.setattr(meta_conversion.time, "sleep", lambda s: None)
    state = {"sheet": {"found": True, "meta": {"views": 10, "cost": 1}, "conversion": {"views": 97549}}, "meta": "ok"}

    def fake_urlopen(req, timeout=0):
        if "/api/meta-ads-pbachi" in req.full_url:
            if state["meta"] != "ok":
                raise urllib.error.HTTPError(req.full_url, 502, "Bad Gateway", {}, None)
            return io.BytesIO(_json.dumps({"scanned": 40, "conversion": {"impressions": 81038}}).encode())
        return io.BytesIO(_json.dumps(state["sheet"]).encode())

    monkeypatch.setattr(ni.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(meta_conversion.urllib.request, "urlopen", fake_urlopen)
    d = ni._fetch_awareness_ads("2026-10-26")
    assert d["conversion"] == {"views": 81038, "source": "meta"} and d["meta"]["views"] == 10
    state["sheet"] = {"found": False}
    assert ni._fetch_awareness_ads("2026-10-26") == {"conversion": {"views": 81038, "source": "meta"}}
    state["meta"] = "down"
    assert ni.conversion_line(ni._fetch_awareness_ads("2026-10-26")["conversion"]) == ni.CONV_PENDING_LINE_META
    # 쫀득바는 그대로 시트 값
    monkeypatch.setattr(ni, "PROFILE", ni.PRODUCT_PROFILES["jd"])
    state["sheet"] = {"found": True, "conversion": {"views": 7}}
    assert ni._fetch_awareness_ads("2026-10-26")["conversion"] == {"views": 7}


def _run_main(monkeypatch, prc, product, date, text, conv, overwrite="false"):
    edits = []
    monkeypatch.setenv("SLACK_BOT_TOKEN", "t")
    monkeypatch.setenv("DATES", date)
    monkeypatch.setenv("DRY_RUN", "false")
    monkeypatch.setenv("OVERWRITE", overwrite)
    monkeypatch.setattr(prc, "PRODUCT", product)
    monkeypatch.setattr(prc, "fetch_conversion", lambda d: conv)
    monkeypatch.setattr(prc, "find_report", lambda tok, d: [{"ts": "1", "text": text, "bot_id": "B"}])

    def fake_slack(method, token, params=None, post=False):
        if method == "chat.update":
            edits.append(params["text"])
            return {"ok": True}
        return {"ok": True, "messages": [{"text": edits[-1] if edits else text}]}

    monkeypatch.setattr(prc, "_slack", fake_slack)
    try:
        prc.main()
    except SystemExit as e:
        assert e.code == 0, e.code
    return edits


def test_main_meta_final_overwrite_only_after_7_days(monkeypatch):
    import datetime as dt
    import patch_report_conversion as prc
    now = dt.datetime.now(dt.timezone.utc).replace(tzinfo=None)
    recent, old = prc.default_dates(now, 7)[5], prc.default_dates(now, 7)[6]   # 6일 전, 7일 전
    assert prc.report_age_days(recent, now) == 6 and prc.report_age_days(old, now) == 7
    assert _run_main(monkeypatch, prc, "pbachi", recent, BACHI_WITH_CONV, 81038) == []
    edits = _run_main(monkeypatch, prc, "pbachi", old, BACHI_WITH_CONV, 81038)
    assert len(edits) == 1 and "    전환 조회수 *+81,038*" in edits[0]
    # 수동 OVERWRITE=true면 나이와 무관하게
    assert len(_run_main(monkeypatch, prc, "pbachi", recent, BACHI_WITH_CONV, 81038, overwrite="true")) == 1
    # 쫀득바(시트 출처)는 기존 값을 절대 덮어쓰지 않는다
    jd = REPORT.replace("    유튜브 *+144,255*  CPV 15.8원\n", "    유튜브 *+144,255*  CPV 15.8원\n    전환 조회수 *+1,000*\n")
    assert _run_main(monkeypatch, prc, "jd", old, jd, 2000, overwrite="true") == []


def test_meta_awareness_values_zero_is_real_but_error_is_blank():
    """인지 계정은 광고 없는 날이 정상 → scanned=0 도 0. 오류·다른 계정 응답은 빈 값(None)."""
    from meta_conversion import meta_awareness_values as v
    ok = {"account": "awareness", "scanned": 30, "total": {"thruplay": 24253.0, "spend": 449429.6, "impressions": 1}}
    assert v(ok) == {"views": 24253, "cost": 449430}
    assert v({"account": "awareness", "scanned": 0, "total": {"thruplay": 0, "spend": 0}}) == {"views": 0, "cost": 0}
    assert v({"account": "awareness", "error": "Meta Graph 오류"}) is None
    assert v({"account": "main", "total": {"thruplay": 5, "spend": 5}}) is None   # 계정 혼동 방지
    assert v(None) is None
