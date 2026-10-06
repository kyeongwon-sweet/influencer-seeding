# '안전망 비활성(YOUTUBE_API_KEY 미등록)' 경고 문구 — 사실 계약 (2026-10-06 추가).
#
# 🚨 왜 고정하나: 원래 문구는 "스크래퍼가 값을 못 주는 날 **전량 유실**된다 —
#    2026-09-08 실제로 268건 유실"이었다. DB 를 세어보니 사실과 달랐다.
#      · 09-08 유튜브 행 268개 중 267개에 조회수가 있다.
#      · 적재일은 당일 8행 / **다음날 소급 260행** — 재시도 큐가 메웠다.
#    즉 영구 유실이 아니라 '하루 지연'이다.
#
# 과장은 양쪽으로 해롭다. 사람을 실제보다 급하게 만들고, 나중에 "복구돼 있잖아"로
# 읽히면 경고 전체의 신뢰가 깎인다. 그렇다고 지워도 안 된다 — 실제 피해(그날 리포트
# 공백 + 다음날 증분 왜곡)는 남아 있고, 키를 넣으면 사라진다.

from pathlib import Path

SRC = (Path(__file__).resolve().parent / "notify_status.py").read_text(encoding="utf-8")
# ⚠️ 검사 대상은 **실제 발송 문구**뿐이다. 위 주석은 옛 문구를 인용해 두므로 포함하면 안 된다
#    (처음에 블록 통째로 검사했다가 주석의 인용에 걸려 오탐했다).
_GUARD = 'if not (os.getenv("YOUTUBE_API_KEY") or "").strip():'
CODE = SRC[SRC.index(_GUARD):]
CODE = CODE[:CODE.index("except Exception")]
MESSAGE = CODE[CODE.index("lines.append("):]


def test_영구유실이라고_단정하지_않는다():
    assert "전량 유실" not in MESSAGE
    assert "268건 유실" not in MESSAGE


def test_실제로_벌어진_일을_그대로_쓴다():
    assert "당일 누락" in MESSAGE
    assert "소급" in MESSAGE
    assert "260건" in MESSAGE, "실측은 260행이다(268은 그날 유튜브 행 전체 수)"


def test_그래도_피해를_지우지_않는다():
    # '복구되니 괜찮다'로 읽히면 키를 영영 안 넣는다. 남는 피해를 문구에 유지한다.
    assert "리포트" in MESSAGE
    assert "증분" in MESSAGE


def test_조치_대상이_명시된다():
    assert "YOUTUBE_API_KEY" in MESSAGE
    assert "GitHub Secret" in MESSAGE


def test_키가_있으면_경고하지_않는다():
    # 조건 자체는 그대로 — 등록되면 줄이 사라져야 한다.
    assert _GUARD in CODE
