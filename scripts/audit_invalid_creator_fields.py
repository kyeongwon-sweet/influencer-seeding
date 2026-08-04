from __future__ import annotations

import argparse
import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from supabase import create_client


SOURCE_PREFIX_MARKERS = "⠿●■◆◇★☆⭐ \t\r\n"


def creator_source_text(value: Any) -> str:
    return str(value or "").strip().lstrip(SOURCE_PREFIX_MARKERS)


def is_creator_parse_source(value: Any) -> bool:
    return creator_source_text(value).startswith("[")


def nonblank(value: Any) -> bool:
    return str(value or "").strip() != ""


def asset_source(row: dict[str, Any]) -> str:
    # asset_name is the current canonical sheet field; project_name is kept as
    # a legacy fallback so old rows with a valid file name are not over-cleared.
    return str(row.get("asset_name") or row.get("project_name") or "").strip()


def load_all_posts(client: Any) -> list[dict[str, Any]]:
    fields = "id,url,account_name,channel_type,asset_name,project_name,planner,creator,created_at"
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
        source = asset_source(row)
        if is_creator_parse_source(source):
            continue
        has_planner = nonblank(row.get("planner"))
        has_creator = nonblank(row.get("creator"))
        if not has_planner and not has_creator:
            continue
        issues.append(
            {
                "id": row.get("id"),
                "url": row.get("url"),
                "account_name": row.get("account_name"),
                "channel_type": row.get("channel_type"),
                "asset_name": row.get("asset_name"),
                "project_name": row.get("project_name"),
                "planner": row.get("planner"),
                "creator": row.get("creator"),
                "clear_creator": has_creator,
                "clear_planner": has_planner,
            }
        )

    creator_count = sum(1 for row in issues if row["clear_creator"])
    planner_count = sum(1 for row in issues if row["clear_planner"])
    selected = [
        row
        for row in issues
        if (args.fields in ("creator", "both") and row["clear_creator"])
        or (args.fields in ("planner", "both") and row["clear_planner"])
    ]
    if args.limit > 0:
        selected = selected[: args.limit]

    summary = {
        "ok": True,
        "total_rows": len(rows),
        "issue_rows": len(issues),
        "creator_issue_rows": creator_count,
        "planner_issue_rows": planner_count,
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
