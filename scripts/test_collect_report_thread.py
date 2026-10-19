# 인지봇 수집 알림 = '자정 수집' 보고 스레드의 댓글 — 행동 계약 (2026-10-19 추가).
#
# 🚨 발단: 10-19 09:16 '수집 사각 감지'가 채널에 새 글로 올라왔다("이런 오류 스레드 댓글로 달기로 했잖아").
#    최서은 요청: "인지봇 수집 보고도 스레드 형식 + 담당자 태그로"(손익트래커봇처럼 제목 한 줄 + 댓글).

from pathlib import Path

import collect_report_thread as crt

TODAY = "2026-10-19"
REPORT = {"ts": "1792360569.469709", "text": "📊 자정 수집 성공 알림 (2026-10-19)"}


class FakeSlack:
    def __init__(self, histories):
        self.histories = list(histories)   # conversations.history 를 부를 때마다 하나씩
        self.posts = []

    def __call__(self, method, payload):
        if method == "conversations.history":
            msgs = self.histories.pop(0) if len(self.histories) > 1 else self.histories[0]
            return {"ok": True, "messages": msgs}
        self.posts.append(payload)
        return {"ok": True, "ts": "9.9"}


def test_사고재현_오늘_보고가_있으면_그_스레드의_댓글로_단다():
    api = FakeSlack([[REPORT]])
    r = crt.post_to_report_thread(api, "C0B659HEYDV", "🚨 수집 사각 감지 8건", TODAY)
    assert r["where"] == "thread"
    assert api.posts == [{"channel": "C0B659HEYDV", "thread_ts": REPORT["ts"], "text": "🚨 수집 사각 감지 8건"}]


def test_다른_날_보고나_남의_스레드_댓글은_부모로_쓰지_않는다():
    msgs = [
        {"ts": "1.1", "text": "📊 자정 수집 성공 알림 (2026-10-18)"},
        {"ts": "2.2", "thread_ts": "1.0", "text": "자정 수집 성공 알림 (2026-10-19) 언급한 댓글"},
    ]
    assert crt.find_report_ts(msgs, TODAY) is None
    assert crt.find_report_ts(msgs + [REPORT], TODAY) == REPORT["ts"]


def test_보고가_늦으면_기다렸다가_스레드에_단다():
    slept = []
    api = FakeSlack([[], [], [REPORT]])
    r = crt.post_to_report_thread(api, "C", "x", TODAY, wait_seconds=600, poll_seconds=60, sleep=slept.append)
    assert r["where"] == "thread" and len(slept) == 2


def test_끝내_보고가_없으면_채널에_바로_올린다_경보유실_금지():
    api = FakeSlack([[]])
    r = crt.post_to_report_thread(api, "C", "🚨 경보", TODAY, wait_seconds=0)
    assert r["where"] == "channel"
    assert "thread_ts" not in api.posts[0]
    assert "자정 수집 보고가 아직 없어" in api.posts[0]["text"] and "🚨 경보" in api.posts[0]["text"]


def test_담당자_태그는_기본_김보나이고_변수로_바꾼다():
    assert crt.mention_prefix({}) == "<@U0C0W2V4X4G> "
    assert crt.mention_prefix({"COLLECT_ALERT_ASSIGNEES": "UA, UB"}) == "<@UA> <@UB> "


def test_보고_제목은_중복판정_열쇠를_유지한다():
    t = crt.report_title("성공", TODAY)
    assert t == "📊 자정 수집 성공 알림 (2026-10-19)"
    assert crt.is_report_message(t, TODAY)
    t2 = crt.report_title("성공", TODAY, attention=3)
    assert t2.endswith("— 확인 필요 3건") and crt.is_report_message(t2, TODAY)


def test_소스계약_세_알림이_스레드_경로를_쓴다():
    here = Path(__file__).resolve().parent
    daily = (here / "daily_collect_report.py").read_text(encoding="utf-8")
    assert 'post({"channel": CHANNEL, "text": title})' in daily, "채널엔 제목 한 줄만"
    assert '"thread_ts": r1["ts"], "text": summary' in daily, "요약은 댓글로"
    for name in ("view_tracking_watchdog.py", "exportstats_watchdog.py"):
        src = (here / name).read_text(encoding="utf-8")
        assert "post_to_report_thread(" in src, f"{name}: 보고 스레드 댓글로 달아야 한다"
        assert "chat.postMessage" not in src, f"{name}: 채널 직접 게시 경로가 남아 있으면 안 된다"
    wf = here.parent / ".github" / "workflows"
    assert 'REPORT_THREAD_WAIT_SECONDS: "1800"' in (wf / "view-tracking-watchdog.yml").read_text(encoding="utf-8")
    assert "REPORT_THREAD_WAIT_SECONDS" in (wf / "exportstats-watchdog.yml").read_text(encoding="utf-8")
