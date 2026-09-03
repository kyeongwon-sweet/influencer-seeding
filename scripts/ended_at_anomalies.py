#!/usr/bin/env python3
"""종료일(ended_at) 이상 감지 — 감지만 하고 절대 자동 보정하지 않는다.

왜 필요한가 (2026-09-03 무디 배너 사건):
    배너 도달수는 '시트 수기 → banner-reach-sync' 단일 경로다. 그런데 게시물이
    **종료된 뒤에 등록**되면 (a) 종료 기간에는 자동수집이 돌지 않았고
    (b) banner-reach-sync가 `measured > ended_at`인 날짜를 버리기 때문에
    도달수가 영구 공백으로 남는다. 화면은 그걸 오랫동안 `0`으로 보여줬다.

    실측(2026-09-03, 게시물 3,473건):
      ① 종료일 < 게시일        11건 — 전부 2026-06 등록, 배너 9건. 게시 전 종료는
                                    구조적으로 불가하며 시트값이 전 날짜 폐기된다.
      ② 등록 시점에 이미 종료   29건 — 배너 2건.
    두 그룹의 고유 배너 11건(①9 + ②2)은 **전부 도달수 0행**이다. 연동시트 전수검증
    (Codex, 읽기전용) 결과 그 11건은 시트 날짜셀·H·DB reach가 모두 공백 — 즉 가드가
    값을 버린 게 아니라 애초에 수기 입력이 없다. 그래서 자동 보정이 아니라 알림이 답이다.

규칙: 이상치는 자동 보정 금지(CLAUDE.md). 사람이 시트·DB에서 정정하도록 알림만 낸다.
윈도우: 최근 등록분은 아직 고칠 수 있으니 상세로, 과거분은 꼬리 카운트로만 — 매일
        같은 과거 목록을 나열해 알림이 무시되는 것을 막는다.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
RECENT_DAYS = 14


def created_kst_date(created_at) -> str | None:
    """created_at(UTC ISO) → KST 날짜. UTC 날짜를 그대로 쓰면 KST 09시 이전 등록이
    하루 앞으로 밀려 판정이 어긋난다(종료일 비교는 날짜 단위라 경계가 실제로 문제됨)."""
    if not created_at:
        return None
    text = str(created_at).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(KST).date().isoformat()


def _ymd(value) -> str | None:
    text = str(value or "")[:10]
    return text if len(text) == 10 else None


def find_ended_at_anomalies(posts, today: str, recent_days: int = RECENT_DAYS) -> dict:
    """종료일 이상 게시물을 두 부류로 나눠 돌려준다.

    ended_before_posted: 종료일 < 게시일 — 구조적으로 불가(시트값 전 날짜 폐기).
    born_ended:          등록 시점에 이미 종료 — 자동수집 창을 놓쳐 지표 공백 위험.
                         ①에 이미 걸린 건은 중복 계상하지 않는다.
    각 항목의 recent = 최근 recent_days일 등록분(아직 정정 가능한 창).
    """
    cutoff = (datetime.fromisoformat(today).date() - timedelta(days=recent_days)).isoformat()
    out = {"ended_before_posted": [], "born_ended": []}
    for post in posts:
        ended = _ymd(post.get("ended_at"))
        if not ended:
            continue                      # 진행 중 — 판정 대상 아님
        posted = _ymd(post.get("posted_at"))
        created = created_kst_date(post.get("created_at"))
        item = {
            "url": post.get("url"),
            "account": (post.get("account_name") or "").strip() or "?",
            "channel_type": (post.get("channel_type") or "").strip(),
            "posted_at": posted,
            "ended_at": ended,
            "created_kst": created,
            "recent": bool(created and created >= cutoff),
        }
        if posted and ended < posted:
            out["ended_before_posted"].append(item)
        elif created and created > ended:
            out["born_ended"].append(item)
    return out


def _fmt(item) -> str:
    posted = (item["posted_at"] or "?")[5:]
    return f"{item['account']}(게시 {posted}·종료 {item['ended_at'][5:]}, {item['url']})"


def ended_at_anomaly_lines(posts, today: str, recent_days: int = RECENT_DAYS,
                           max_detail: int = 3) -> list[str]:
    """상태 알림용 한 줄 문구. 최근 등록분은 URL까지 짚고(계정명만으론 게시물 특정 불가),
    과거분은 건수만 남긴다. 이상 없으면 빈 목록."""
    found = find_ended_at_anomalies(posts, today, recent_days)
    lines = []
    specs = [
        ("ended_before_posted", "🔴 종료일<게시일",
         "게시 전 종료는 구조적으로 불가(시트 도달수·조회수가 전 날짜 폐기됨)"),
        ("born_ended", "등록 시점 이미 종료",
         "자동수집 창을 놓쳐 지표가 영구 공백으로 남음"),
    ]
    for key, label, why in specs:
        items = found[key]
        if not items:
            continue
        recent = [x for x in items if x["recent"]]
        older = len(items) - len(recent)
        if recent:
            ex = ", ".join(_fmt(x) for x in recent[:max_detail])
            line = f"{label} {len(recent)}건 — {why}: {ex}"
            if len(recent) > max_detail:
                line += f" … 외 {len(recent) - max_detail}건"
            if older:
                line += f" / 그 외 과거 등록분 {older}건"
        else:
            line = f"{label} 과거 등록분 {older}건 — {why} (정정 대기, 시트·DB에서 종료일 수정 필요)"
        lines.append(line)
    return lines
