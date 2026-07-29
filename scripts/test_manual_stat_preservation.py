from run_monitoring import _filter_manual_preserved_rows


def test_same_date_manual_row_is_removed_from_auto_upsert():
    rows = [
        {"post_id": "p1", "measured_at": "2026-07-28", "play_count": 2112},
        {"post_id": "p2", "measured_at": "2026-07-28", "play_count": 915},
    ]

    kept, skipped = _filter_manual_preserved_rows(rows, {"p1|2026-07-28"})

    assert kept == [rows[1]]
    assert skipped == [rows[0]]


def test_manual_preservation_is_date_specific():
    rows = [{"post_id": "p1", "measured_at": "2026-07-29", "play_count": 2300}]

    kept, skipped = _filter_manual_preserved_rows(rows, {"p1|2026-07-28"})

    assert kept == rows
    assert skipped == []


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()


if __name__ == "__main__":
    _run_all()
    print("manual stat preservation regression tests passed")
