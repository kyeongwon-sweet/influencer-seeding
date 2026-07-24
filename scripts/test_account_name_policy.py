from account_name_policy import collected_account_name_update


def test_viral_channel_prefers_owner_username_even_when_display_name_exists():
    post = {"channel_type": "바이럴 (영상)", "account_name": "루나의 웃긴 영상"}
    collected = {"owner_username": "luna.player", "account_name": "루나의 웃긴 영상"}
    assert collected_account_name_update(post, collected) == "luna.player"


def test_viral_handle_marker_is_removed():
    post = {"channel_type": "바이럴 (배너)", "account_name": ""}
    collected = {"owner_username": "@ufo__green", "account_name": "유에프오"}
    assert collected_account_name_update(post, collected) == "ufo__green"


def test_nonviral_existing_name_is_preserved():
    post = {"channel_type": "협찬 (인플루언서)", "account_name": "표시명"}
    collected = {"owner_username": "handle", "account_name": "새 표시명"}
    assert collected_account_name_update(post, collected) is None


def test_nonviral_blank_name_uses_collected_display_name():
    post = {"channel_type": "협찬 (인플루언서)", "account_name": ""}
    collected = {"owner_username": "handle", "account_name": "표시명"}
    assert collected_account_name_update(post, collected) == "표시명"


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()


if __name__ == "__main__":
    _run_all()
    print("account_name policy regression tests passed")
