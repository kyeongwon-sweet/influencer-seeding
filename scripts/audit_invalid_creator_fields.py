from __future__ import annotations

import argparse
import json
import os
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from supabase import create_client


SOURCE_PREFIX_MARKERS = "⠿●■◆◇★☆⭐ \t\r\n"

# 소재명 앞에 붙는 장식/드래그핸들 문자를 **폭넓게** 벗긴다.
# 위 목록은 그동안 발견된 글자를 하나씩 추가해 온 방식이라, 새 장식 문자가 등장하면
# 정상 소재명을 "파싱 불가"로 오판하고 담당자 값을 이상값으로 잡는다.
# → 유니코드 카테고리로 일반화: S*(기호)·P*(구두점)·Z*(공백)·C*(제어/포맷)를 앞에서 제거.
#   단 '['는 소재명 규칙의 시작 문자이므로 절대 벗기지 않는다.
def _strip_decorative_prefix(text: str) -> str:
    i = 0
    while i < len(text):
        ch = text[i]
        if ch == "[":
            break
        if ch in SOURCE_PREFIX_MARKERS or unicodedata.category(ch)[0] in ("S", "P", "Z", "C"):
            i += 1
            continue
        break
    return text[i:]


def creator_source_text(value: Any) -> str:
    return _strip_decorative_prefix(str(value or "").strip())


def is_creator_parse_source(value: Any) -> bool:
    return creator_source_text(value).startswith("[")


# 비광고성 미러링 콘텐츠는 **소재명에 담당자를 적지 않는 규칙**이다(광고 소재 파일명 규칙과 다름).
# 예: "비광고성_외부영상_미러링_이나연_슈퍼카" — 기획자가 있어도 소재명에서 유도할 수 없다.
# 그래서 이 유형은 애초에 판정 대상이 아니다(2026-08-07 실측 50건, 전부 위성채널·비용 0).
# ⚠️ 'channel_type=위성채널 AND cost=0'을 기준으로 쓰면 안 된다 — 그 조건은 345건이라
#    `[26.07]…` 같은 **정상 광고 소재까지 통째로 제외**된다(실측).
NON_AD_SOURCE_PREFIXES = ("비광고성",)


def is_non_ad_source(value: Any) -> bool:
    return creator_source_text(value).startswith(NON_AD_SOURCE_PREFIXES)


def nonblank(value: Any) -> bool:
    return str(value or "").strip() != ""


def asset_source(row: dict[str, Any]) -> str:
    # asset_name is the current canonical sheet field; project_name is kept as
    # a legacy fallback so old rows with a valid file name are not over-cleared.
    return str(row.get("asset_name") or row.get("project_name") or "").strip()


def build_issue(row: dict[str, Any]) -> dict[str, Any] | None:
    """이상값 후보 1행 판정(네트워크 없음 = 테스트 가능).

    반환 None = 이상 아님. 제외 조건:
      · 소재명이 파일명 규칙(`[...]`)을 따름 → 담당자를 유도할 수 있으므로 정상
      · 비광고성 미러링 → 애초에 소재명에 담당자를 안 적는 규칙
      · 기획자·제작자가 둘 다 비어 있음 → 지울 게 없음
    """
    source = asset_source(row)
    if is_creator_parse_source(source):
        return None
    if is_non_ad_source(source):
        return None
    has_planner = nonblank(row.get("planner"))
    has_creator = nonblank(row.get("creator"))
    if not has_planner and not has_creator:
        return None
    manual_fields = row.get("manual_fields") if isinstance(row.get("manual_fields"), list) else []
    manual_creator = "creator" in manual_fields
    manual_planner = "planner" in manual_fields
    return {
        "id": row.get("id"),
        "url": row.get("url"),
        "account_name": row.get("account_name"),
        "channel_type": row.get("channel_type"),
        "asset_name": row.get("asset_name"),
        "project_name": row.get("project_name"),
        "planner": row.get("planner"),
        "creator": row.get("creator"),
        "manual_fields": manual_fields,
        "manual_creator": manual_creator,
        "manual_planner": manual_planner,
        # 🚨 수동 입력분은 절대 자동으로 지우지 않는다(2026-08-07 사용자 지시
        #    "제작자, 기획자 수동 입력건은 유지해"). 보고에는 남기되 --apply 대상에서 뺀다.
        "clear_creator": has_creator and not manual_creator,
        "clear_planner": has_planner and not manual_planner,
    }


def select_for_update(issues: list[dict[str, Any]], fields: str) -> list[dict[str, Any]]:
    """--apply 로 실제 비울 행. `clear_*`가 이미 수동 입력분을 제외한 값이다."""
    return [
        row
        for row in issues
        if (fields in ("creator", "both") and row["clear_creator"])
        or (fields in ("planner", "both") and row["clear_planner"])
    ]


def load_all_posts(client: Any) -> list[dict[str, Any]]:
    fields = "id,url,account_name,channel_type,asset_name,project_name,planner,creator,manual_fields,created_at"
    out: list[dict[str, Any]] = []
    page_size = 1000
    start = 0
    while True:
        end = start + page_size - 1
        res = (
            client.table("sponsored_posts")
            .select(fields)
            .range(start, end)
            .execute()
        )
        rows = list(res.data or [])
        out.extend(rows)
        if len(rows) < page_size:
            return out
        start += page_size


def make_backup(rows: list[dict[str, Any]], repo_root: Path) -> Path:
    backup_dir = repo_root / "scratchpad"
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = backup_dir / f"invalid_creator_fields_backup_{stamp}.json"
    path.write_text(
        json.dumps(
            {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "rows": rows,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return path


def send_slack(summary: dict[str, Any]) -> None:
    if summary["issue_rows"] <= 0:
        return
    token = os.environ.get("SLACK_BOT_TOKEN")
    channel = os.environ.get("STATUS_USER") or os.environ.get("SLACK_CHANNEL")
    if not token or not channel:
        print("[INVALID_CREATOR_FIELDS_SLACK_SKIP] missing Slack token/channel")
        return
    samples = summary.get("samples") or []
    sample_lines = []
    for row in samples[:8]:
        label = row.get("account_name") or row.get("url") or row.get("id")
        sample_lines.append(
            f"• {label} — creator={row.get('creator') or '-'} / planner={row.get('planner') or '-'} / asset={row.get('asset_name') or row.get('project_name') or '-'}"
        )
    text = (
        ":rotating_light: [제작자 자동채움 가드] 소재명 파일명 없이 기획자/제작자가 채워진 행 "
        f"{summary['issue_rows']}건 감지\n"
        f"creator {summary['creator_issue_rows']}건 · planner {summary['planner_issue_rows']}건\n"
        + "\n".join(sample_lines)
    )
    data = urllib.parse.urlencode({"channel": channel, "text": text}).encode()
    req = urllib.request.Request(
        "https://slack.com/api/chat.postMessage",
        data=data,
        headers={"Authorization": "Bearer " + token},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    print("[INVALID_CREATOR_FIELDS_SLACK] " + json.dumps({"ok": body.get("ok"), "error": body.get("error")}, ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Find or clear sponsored_posts creator/planner values that cannot be derived from the row's own asset name.",
    )
    parser.add_argument("--apply", action="store_true", help="Clear selected fields after writing a backup.")
    parser.add_argument("--send", action="store_true", help="Send Slack only when issues exist.")
    parser.add_argument(
        "--fields",
        choices=["creator", "planner", "both"],
        default="creator",
        help="Fields to clear when applying. The audit always reports both.",
    )
    parser.add_argument("--limit", type=int, default=0, help="Optional max rows to update, for staged repairs.")
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")

    client = create_client(url, key)
    repo_root = Path(__file__).resolve().parents[1]
    rows = load_all_posts(client)

    issues: list[dict[str, Any]] = []
    for row in rows:
        issue = build_issue(row)
        if issue is not None:
            issues.append(issue)

    # 보고 수치는 '이상값이 있는 행' 기준(수동 입력 포함), 실제 삭제는 clear_* 기준(수동 제외).
    creator_count = sum(1 for row in issues if nonblank(row["creator"]))
    planner_count = sum(1 for row in issues if nonblank(row["planner"]))
    manual_creator_count = sum(1 for row in issues if nonblank(row["creator"]) and row["manual_creator"])
    manual_planner_count = sum(1 for row in issues if nonblank(row["planner"]) and row["manual_planner"])
    selected = select_for_update(issues, args.fields)
    if args.limit > 0:
        selected = selected[: args.limit]

    summary = {
        "ok": True,
        "total_rows": len(rows),
        "issue_rows": len(issues),
        "creator_issue_rows": creator_count,
        "planner_issue_rows": planner_count,
        "manual_creator_issue_rows": manual_creator_count,
        "manual_planner_issue_rows": manual_planner_count,
        "selected_for_update": len(selected),
        "fields": args.fields,
        "apply": args.apply,
        "samples": issues[:20],
    }
    print("[INVALID_CREATOR_FIELDS_AUDIT] " + json.dumps(summary, ensure_ascii=False))

    if args.send:
        send_slack(summary)

    if not args.apply:
        return
    if not selected:
        print("[INVALID_CREATOR_FIELDS_REPAIR] " + json.dumps({"updated": 0}, ensure_ascii=False))
        return

    backup_path = make_backup(selected, repo_root)
    updated = 0
    for row in selected:
        patch: dict[str, Any] = {}
        if args.fields in ("creator", "both") and row["clear_creator"]:
            patch["creator"] = None
        if args.fields in ("planner", "both") and row["clear_planner"]:
            patch["planner"] = None
        if not patch:
            continue
        res = (
            client.table("sponsored_posts")
            .update(patch)
            .eq("id", row["id"])
            .execute()
        )
        updated += len(res.data or [])

    print(
        "[INVALID_CREATOR_FIELDS_REPAIR] "
        + json.dumps(
            {
                "updated": updated,
                "backup_path": str(backup_path),
                "fields": args.fields,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
