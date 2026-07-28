from run_monitoring import _needs_metadata_recollect


def test_blank_instagram_post_needs_metadata_recollect():
    post = {
        "url": "https://www.instagram.com/reel/DbS5X8WBgmM/",
        "account_name": "",
    }
    assert _needs_metadata_recollect(post)


def test_existing_account_name_does_not_recollect_for_metadata():
    post = {
        "url": "https://www.instagram.com/reel/DbS5X8WBgmM/",
        "account_name": "some_handle",
    }
    assert not _needs_metadata_recollect(post)


def test_non_instagram_url_does_not_recollect_for_metadata():
    post = {
        "url": "https://youtube.com/shorts/example",
        "account_name": "",
    }
    assert not _needs_metadata_recollect(post)


def test_instagram_profile_url_does_not_recollect_for_metadata():
    post = {
        "url": "https://www.instagram.com/some_handle/",
        "account_name": "",
    }
    assert not _needs_metadata_recollect(post)


def _run_all():
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()


if __name__ == "__main__":
    _run_all()
    print("metadata recollect regression tests passed")
