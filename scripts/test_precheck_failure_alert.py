from precheck_failure_alert import build_text


def test_egress_quota_is_named_first():
    log = ("Traceback ...\n"
           "postgrest.exceptions.APIError: {'code': '402', 'details': '{\"message\":\"Service for this project "
           "is restricted due to the following violations: exceed_egress_quota.\"}'}")
    text = build_text(log, "https://github.com/x/y/actions/runs/1")
    assert text.splitlines()[0].startswith("*🚨 Supabase 전송량(egress) 한도 초과")
    assert "exceed_egress_quota" in text
    assert text.endswith("실행: https://github.com/x/y/actions/runs/1")


def test_other_failures_and_missing_log():
    assert build_text("boom").startswith("*❌ 수집 사전점검 실패")
    assert "(점검 로그 없음)" in build_text("")
    long_log = "\n".join(f"line {i}" for i in range(100))
    text = build_text(long_log)
    assert "line 99" in text and "line 87" not in text   # 끝 12줄만
