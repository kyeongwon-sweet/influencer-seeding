"""수기 입력 조회수의 오기 감지(알림 전용, 차단 아님).

배경(2026-08-12 실측 사고):
  s_3.mag `/p/DbLMD9Oma7P/` 가 `10 → 14 → 199,379 → 207,000`으로 기록됐다.
  199,379는 같은 날(07-29) **빵친장 `/p/DbNyGcjsZ4J/`의 자동 수집값과 6자리 완전 일치**했고,
  s_3.mag 쪽 큰 값은 전부 수기 입력이었다. 즉 다른 게시물 값을 옮겨 적은 오기다.
  약 20.7만 조회수가 2주 넘게 과대계상됐는데 **알림이 하나도 안 떴다.**

왜 놓쳤나:
  `notify_status._integrity_lines`의 복사 오염 감지(5번)는 **종료된 게시물만** 순회한다
  (`for pid, ed in ended.items()`). 이 건은 활성이라 대상에서 빠졌다.
  복사 지문 `(날짜,값)` 인덱스는 이미 전체 게시물로 만들어져 있었는데 판정만 닿지 않았다.

🔎 알림이 떴을 때 사람이 쓰는 판별 기준 (2026-08-12 오탐 10건 실측에서 도출).
   가장 강한 신호는 **의심값 뒤에 자동 수집값이 이어지는가**다.
     · 이어진다 → 그 값은 실제였다. 자동 수집이 그 궤적을 물려받았다는 뜻이다.
       (실측 오탐: ufo__night 07-31=4,504는 게시 당일 값이고 08-01부터 84,355→89,012로 자동 수집이 이어졌다.
        김뿌잉뿌잉 07-18=1,514도 첫날 값이며 실물 조회수 3,119가 DB 3,117과 일치했다.)
     · 뒤가 전부 NULL이고 게시물도 삭제됐다 → 검증할 방법이 없고 오기 가능성이 높다.
       (실제 사고 s_3.mag: 199,379 뒤로 자동 수집이 한 번도 안 붙었고 게시물은 삭제됐다.)
   ⚠️ 이 조건은 코드에 넣지 않았다. 더 조이면 진짜를 놓칠 수 있고, 배너 제외만으로
      28→10건까지 줄어 사람이 훑을 만한 규모가 됐다. 판정은 사람이 한다(절대규칙: 감지만).

설계 원칙:
  · **자동 수집이 아니라 수기 입력만** 본다. 자동값은 액터가 만들어 타 게시물 복사가 구조적으로 어렵고,
    자동 급등은 실제 바이럴이 많다(2026-08-07 ufo__skyblue 2,479→63,119는 실측 확인된 진짜 급등).
  · 복사 지문은 **거의 확실한 증거**(큰 수의 완전 일치)라 단정적으로 알린다.
  · 급등은 **정황일 뿐**이라 '확인 요청'으로만 낸다 — 차단·자동 정정은 하지 않는다(절대규칙).
"""
from __future__ import annotations

# 우연 일치를 배제할 최소 자릿수. 3, 10, 14 같은 작은 값은 서로 다른 게시물에서 흔히 겹친다.
MIN_COPY_VALUE = 1000
# 반올림된 수기값은 우연히 겹친다 — 실측: 267,000 / 89,000 / 109,000 같은 값들이 오탐 대량 생산
# (전체 112건 → 끝 100단위 제외 시 49행·28게시물). 사고값 199,379처럼 끝자리가 살아있는 수는
# 서로 다른 게시물에서 같은 날 겹칠 확률이 사실상 0이라, 정밀도를 택한다.
# ⚠️ 트레이드오프: 반올림된 값의 진짜 복사는 놓친다. 알림은 정밀도가 낮으면 아무도 안 보므로 이쪽을 택했다.
COPY_ROUNDING_EXCLUDE = 100
# 수기 급등 배수 임계 — 실제 바이럴도 하루 수 배는 흔하므로 넉넉하게 잡는다.
MIN_SPIKE_MULTIPLE = 20
MIN_SPIKE_VALUE = 10_000
# 직전값이 한 자리·두 자리면 배수가 의미 없다(신규 게시물 초기 성장: 3→2,201은 정상).
# 실측: prev 하한 없으면 9건 중 3건이 유튜브 쇼츠 초기 성장 오탐이었다.
MIN_SPIKE_PREV = 1000


def _has_later_automatic(rows, date: str, *, min_value: float = 0) -> bool:
    """의심값 **이후에 자동 수집이 이어졌는가**.

    이어졌다면 그 값은 실제였다는 뜻이다 — 자동 수집이 그 궤적을 물려받았다.
    오기라면 이어질 곳이 없다(실제 사고 s_3.mag은 199,379 뒤가 전부 NULL이었다).
    """
    for d, v, manual in rows:
        if d > date and not manual and v is not None and v >= min_value:
            return True
    return False


def copy_suspects(rows, value_owners, *, min_value: int = MIN_COPY_VALUE,
                  rounding_exclude: int = COPY_ROUNDING_EXCLUDE,
                  skip_if_confirmed: bool = True):
    """수기 입력값이 같은 (날짜,값)으로 다른 게시물에도 있으면 복사 의심.

    rows: [(date, value, manual)] — 한 게시물의 이력
    value_owners: {(date, value): {post_id, ...}} — 전체 게시물 기준 역인덱스
    반환: [(date, value, [해당 (날짜,값)을 가진 게시물 id 전체])]
    """
    out = []
    for date, value, manual in rows:
        if not manual or value is None or value < min_value:
            continue
        if rounding_exclude and value % rounding_exclude == 0:
            continue                      # 반올림 입력끼리의 우연 일치 배제
        owners = value_owners.get((date, value)) or ()
        if len(owners) > 1:
            if skip_if_confirmed and _has_later_automatic(rows, date):
                continue          # 이후 자동 수집이 궤적을 이어받음 = 실제 값
            out.append((date, value, sorted(owners)))
    return out


def spike_suspects(rows, *, min_multiple: float = MIN_SPIKE_MULTIPLE, min_value: int = MIN_SPIKE_VALUE,
                   min_prev: int = MIN_SPIKE_PREV, skip_if_confirmed: bool = True):
    """수기 입력이 직전 실측 대비 과도한 배수로 뛰면 확인 요청.

    직전 '유효 실측'과 비교한다(빈 값은 건너뜀 — 공백을 0으로 읽지 않는다).
    반환: [(date, value, prev_value, multiple)]
    """
    out = []
    prev = None
    for date, value, manual in sorted(rows, key=lambda r: r[0]):
        if value is None or value <= 0:
            continue                      # 미측정은 비교 기준이 아니다(공백≠0)
        if manual and prev is not None and prev >= min_prev and value >= min_value:
            mult = value / prev
            # 이후 자동 수집이 그 값 수준(90% 이상)을 물려받았으면 실제 급등이다.
            # 실측 오탐: some2lve 1,020→47,463 뒤 자동 52,689 / hana.humor 3,033→73,798 뒤 자동 75,942.
            confirmed = skip_if_confirmed and _has_later_automatic(rows, date, min_value=value * 0.9)
            if mult >= min_multiple and not confirmed:
                out.append((date, value, prev, mult))
        prev = value
    return out
