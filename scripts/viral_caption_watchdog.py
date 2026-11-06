#!/usr/bin/env python
"""바이럴 캡션 = 소재명 상단 카피 워치독.

목적: 바이럴 행의 캡션은 소재명(파일명 규칙)에서 뽑은 상단 카피여야 하는데, 규칙이 **조용히**
소재명을 못 알아봐 게시물 캡션이 그대로 남는 사고를 매일 자동으로 잡아 Slack으로 알린다.

배경(같은 종류 사고가 1주일에 2번, 둘 다 사람이 눈으로 발견):
  · 2026-10-29~ 새 파일명 형식(제품 표시에 P 없음) → 17행 미적용(11-03 발견).
  · 2026-10-29~ 맥에서 복사한 소재명이 자모로 쪼개진 한글(NFD) → 22행 미적용(11-06 발견).
  앞으로 파일명 형식이 또 바뀌어도 같은 방식으로 잡히도록, 파서를 다시 구현하지 않고
  **결과 상태를 직접** 본다([[proxy-signal-vs-real-state]]):
    소재명에서 뽑은 캡션은 언제나 소재명의 연속된 일부다(뒤쪽 .X·.디자인N·점만 떼어냄).
    → 캡션이 비었거나 소재명 안에 없으면 = 상단 카피가 아니다.

검사 대상(오탐 방지, 2026-11-06 DB 실측: 14일 창 58건 중 0건으로 출발):
  · 채널분류에 '바이럴'
  · DB 등록(created_at)이 최근 WINDOW_DAYS(14)일 — 지난 일은 사람이 이미 본 것
  · 소재명이 파일명 규칙 모양: `[YY.MM]F_` 로 시작하고 6자리 날짜(YYMMDD)가 있음
  · 그 날짜가 ASSET_MAX_AGE_DAYS(45)일 이내 — 9월에 옛 25년 소재 수백 건을 한꺼번에 등록한 것 같은
    소급 등록은 옛 형식(문장 캡션 보존 정책)이라 제외
읽기 전용(sponsored_posts 조회만). --send 없으면 콘솔 출력만.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import unicodedata
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import db_probe as db  # noqa: E402
from collect_report_thread import mention_prefix, post_to_report_thread, slack_api  # noqa: E402
from kst_dates import kst_date, kst_today  # noqa: E402

SLACK_TOKEN = os.getenv("INJIBOT_SLACK_TOKEN")
SLACK_CHANNEL = os.getenv("VIRAL_CAPTION_WATCHDOG_SLACK_CHANNEL", "C0B659HEYDV")  # #빙과_마케팅_스틱바p
WINDOW_DAYS = 14
ASSET_MAX_AGE_DAYS = 45
MAX_LISTED = 10

RULE_SHAPE = re.compile(r"^\[\d\d\.\d\d\]F_")
DATE_TOKEN = re.compile(r"^\d{6}$")


def nfc(value) -> str:
    return unicodedata.normalize("NFC", str(value or "")).strip()


def asset_date(asset: str) -> date | None:
    """소재명의 마지막 6자리 날짜(YYMMDD). 없거나 날짜가 아니면 None."""
    tokens = [t.strip() for t in asset.split("_") if DATE_TOKEN.match(t.strip())]
    if not tokens:
        return None
    t = tokens[-1]
    try:
        return date(2000 + int(t[:2]), int(t[2:4]), int(t[4:]))
    except ValueError:
        return None


def miss_reason(row: dict) -> str:
    asset = nfc(row.get("asset_name"))
    caption = nfc(row.get("content_summary"))
    ctype = str(row.get("channel_type") or "")
    if ".배너_" in asset and "배너" not in ctype:
        return "소재명은 배너인데 채널분류가 영상"
    if not caption:
        return "캡션 빈칸"
    return "소재명 규칙을 못 알아봄(파일명 형식 변경 의심)"


def find_misses(rows: list[dict], today: date) -> tuple[int, list[dict]]:
    """(검사 대상 수, 상단 카피가 아닌 행들)."""
    since = (today - timedelta(days=WINDOW_DAYS)).isoformat()
    checked, misses = 0, []
    for r in rows:
        if "바이럴" not in str(r.get("channel_type") or ""):
            continue
        created = kst_date(r.get("created_at"))
        if created < since or created > today.isoformat():  # --date로 과거를 볼 때 그 뒤 등록분 제외
            continue
        asset = nfc(r.get("asset_name"))
        if not RULE_SHAPE.match(asset):
            continue
        d = asset_date(asset)
        if d is None or (today - d).days > ASSET_MAX_AGE_DAYS:
            continue
        checked += 1
        caption = nfc(r.get("content_summary"))
        if not caption or caption not in asset:
            misses.append(dict(r, reason=miss_reason(r)))
    return checked, misses


def slack_text(checked: int, misses: list[dict]) -> str:
    lines = [
        f":warning: *바이럴 캡션에 상단 카피 미적용 {len(misses)}건* "
        f"(최근 {WINDOW_DAYS}일 등록 바이럴 {checked}건 검사)",
        "소재명 파일명 규칙에서 상단 카피를 못 뽑아 게시물 캡션이 남아 있습니다.",
    ]
    for r in misses[:MAX_LISTED]:
        caption = nfc(r.get("content_summary"))[:30] or "(빈칸)"
        lines.append(f"• {r.get('url')} — {r['reason']} · 현재 캡션: {caption}")
    if len(misses) > MAX_LISTED:
        lines.append(f"• …외 {len(misses) - MAX_LISTED}건")
    lines.append("• 조치: 소재명·채널분류 확인 → 규칙 문제면 Claude에 전달(캡션 규칙 `captionFromAssetName_`).")
    return "\n".join(lines)


def fetch_rows(env, today: date) -> list[dict]:
    since = (today - timedelta(days=WINDOW_DAYS + 1)).isoformat()  # 여유 1일, 정확한 KST 판정은 find_misses
    return db.fetch_all(env, "sponsored_posts", {
        "select": "id,url,asset_name,content_summary,channel_type,product_name,created_at",
        "channel_type": "like.*바이럴*",
        "created_at": f"gte.{since}",
        "order": "id.asc",
    })


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", default=kst_today())
    parser.add_argument("--send", action="store_true", help="미적용이 있으면 Slack 발송")
    args = parser.parse_args()

    today = date.fromisoformat(args.date)
    env = db.load_env()
    checked, misses = find_misses(fetch_rows(env, today), today)
    print("[VIRAL_CAPTION_WATCHDOG]", json.dumps(
        {"date": args.date, "checked": checked, "misses": len(misses),
         "urls": [m.get("url") for m in misses]}, ensure_ascii=False))
    if checked == 0:
        # 분모 0은 '정상'이 아니라 '아무것도 못 봤다'일 수 있다 — 로그로 남긴다(알림은 안 함: 신규 바이럴이 없는 주도 있다).
        print("[WARN] 검사 대상 0건 — 최근 바이럴 등록이 없거나 조회 조건 확인 필요")
    if misses:
        text = slack_text(checked, misses)
        print(text)
        if args.send:
            if not SLACK_TOKEN:
                print("[WARN] INJIBOT_SLACK_TOKEN 없음 — 발송 스킵")
            else:
                products = [m.get("product_name") for m in misses]
                res = post_to_report_thread(
                    slack_api(SLACK_TOKEN), SLACK_CHANNEL, mention_prefix(products=products) + text, args.date,
                    wait_seconds=int(os.getenv("REPORT_THREAD_WAIT_SECONDS", "0")),
                )
                print("[SLACK]", json.dumps(res, ensure_ascii=False))
                if not res.get("ok"):
                    return 1  # 발송 실패는 GHA 빨간불로 드러낸다(조용한 실패 금지)
    else:
        print(f"✅ 바이럴 캡션 정상 — 검사 {checked}건 중 미적용 0건")
    return 0


if __name__ == "__main__":
    sys.exit(main())
