from end_reviewed_archived_viral_videos import select_targets


def _post(post_id: str):
    return {"id": post_id, "ended_at": None, "review_requested_at": "2026-08-12T00:00:00Z"}


def _stat(post_id: str, day: str, play_count=100):
    return {
        "id": f"{post_id}-{day}",
        "post_id": post_id,
        "measured_at": day,
        "play_count": play_count,
    }


def test_selects_measured_august_tenth_and_missing_august_eleventh():
    posts = [_post("target"), _post("measured-next"), _post("blank"), _post("no-first")]
    stats = [
        _stat("target", "2026-08-10"),
        _stat("measured-next", "2026-08-10"),
        _stat("measured-next", "2026-08-11"),
        _stat("blank", "2026-08-10", None),
        _stat("no-first", "2026-08-09"),
    ]

    targets, measured_rows = select_targets(posts, stats)

    assert [post["id"] for post in targets] == ["target"]
    assert measured_rows["target"]["play_count"] == 100
