#!/usr/bin/env python3
# 일회성(2026-08-27): 자정수집 리포트 채널 정정.
#   - 9:35 잘못된 "확인필요 56건" 메시지(본문+스레드)를 정정본(2건)으로 chat.update
#   - 10:02·10:08 중복 정정본(본문+스레드) chat.delete
# inji-bot이 쓴 메시지라 봇 토큰(INJIBOT_SLACK_TOKEN)으로만 수정/삭제 가능 → GHA에서 실행.
import os, sys, json, subprocess, urllib.request

TOK = os.environ["INJIBOT_SLACK_TOKEN"]
CHANNEL = "C0B659HEYDV"
EDIT_MAIN = "1787790909.908769"     # 9:35 본문(56건)
EDIT_THREAD = "1787790910.094779"   # 9:35 스레드
DELETE = [
    "1787792527.512809", "1787792527.762319",   # 10:02 중복(본문·스레드)
    "1787792915.181919", "1787792915.305839",   # 10:08 중복(본문·스레드)
]

def api(method, payload):
    req = urllib.request.Request(
        "https://slack.com/api/" + method,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": "Bearer " + TOK, "Content-Type": "application/json; charset=utf-8"})
    return json.load(urllib.request.urlopen(req, timeout=20))

# 정정 내용은 리포트 dry-run(수정본 코드) 출력을 파싱해 그대로 사용.
env = dict(os.environ)
out = subprocess.run([sys.executable, "scripts/daily_collect_report.py", "--date", "2026-08-26"],
                     capture_output=True, text=True, env=env).stdout
if "===== 본문 =====" not in out:
    print("ERROR: 리포트 본문 생성 실패\n" + out[-2000:]); sys.exit(1)
after = out.split("===== 본문 =====", 1)[1]
if "===== 실패 스레드 =====" in after:
    body = after.split("===== 실패 스레드 =====", 1)[0].strip("\n")
    thread = after.split("===== 실패 스레드 =====", 1)[1].split("\n(measured_at=", 1)[0].strip("\n")
else:
    body = after.split("\n(measured_at=", 1)[0].strip("\n")
    thread = None

print("=== 정정 본문 미리보기 ===\n" + body[:400])

r = api("chat.update", {"channel": CHANNEL, "ts": EDIT_MAIN, "text": body})
print("update main:", r.get("ok"), r.get("error"))
if thread:
    r = api("chat.update", {"channel": CHANNEL, "ts": EDIT_THREAD, "text": thread})
    print("update thread:", r.get("ok"), r.get("error"))

for ts in DELETE:
    r = api("chat.delete", {"channel": CHANNEL, "ts": ts})
    print("delete", ts, r.get("ok"), r.get("error"))
