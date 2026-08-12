from end_archived_viral_videos import select_targets


def _post(post_id: str):
    return {"id": post_id, "ended_at": None, "channel_type": "바이럴 (영상)"}


def _stat(post_id: str, day: str):
    return {"id": f"{post_id}-{day}", "post_id": post_id, "measured_at": day}


def test_only_two_day_missing_with_august_ninth_history_is_selected():
    posts = [_post("target"), _post("one-day"), _post("old-gap"), _post("new")]
    stats = [
        _stat("target", "2026-08-09"),
        _stat("one-day", "2026-08-10"),
        _stat("old-gap", "2026-08-08"),
    ]

    targets, latest, one_day_missing = select_targets(posts, stats)

    assert [post["id"] for post in targets] == ["target"]
    assert latest["target"]["measured_at"] == "2026-08-09"
    assert one_day_missing == 1


def test_missing_dates_are_checked_by_row_presence_not_metric_value():
    posts = [_post("blank-row")]
    stats = [
        _stat("blank-row", "2026-08-09"),
        {**_stat("blank-row", "2026-08-10"), "play_count": None},
    ]

    targets, _, one_day_missing = select_targets(posts, stats)

    assert targets == []
    assert one_day_missing == 1
