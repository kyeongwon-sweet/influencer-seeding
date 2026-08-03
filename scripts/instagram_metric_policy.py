"""Instagram 수집기의 플랫폼 전용 지표 선택 규칙."""


def pick_instagram_metric(metrics, aggregate_key, facebook_key, instagram_key=None):
    """Instagram 값만 반환한다.

    data-slayer의 ``play_count``/``like_count``/``comment_count``는 Facebook
    교차게시 지표까지 합산할 수 있다. 명시적인 Instagram 지표가 있으면 그것을
    우선하고, 없으면 aggregate에서 Facebook 부분만 뺀다.
    """
    metrics = metrics or {}
    if instagram_key:
        instagram_value = metrics.get(instagram_key)
        if isinstance(instagram_value, (int, float)):
            return instagram_value

    aggregate_value = metrics.get(aggregate_key)
    if not isinstance(aggregate_value, (int, float)):
        return aggregate_value

    facebook_value = metrics.get(facebook_key)
    if isinstance(facebook_value, (int, float)):
        instagram_value = aggregate_value - facebook_value
        if instagram_value >= 0:
            return instagram_value
    return aggregate_value
