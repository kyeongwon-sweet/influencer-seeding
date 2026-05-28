from __future__ import annotations
from datetime import datetime
import gspread
from gspread.exceptions import WorksheetNotFound
from config import OAUTH_CREDENTIALS_PATH, SPREADSHEET_ID, SHEET_NAME

# C열부터 시작하는 지표 헤더 순서
METRIC_HEADERS = [
    "실행일",
    "팔로워 수", "팔로워 대비 평균 재생수", "100만뷰 이상 여부",
    "총 게시물", "일반 게시물", "광고 게시물",
    "총 평균 순조회수", "일반 평균 순조회수", "광고 평균 순조회수",
    "총 평균 재생수", "일반 평균 재생수", "광고 평균 재생수",
    "총 Like 비율", "일반 Like 비율", "광고 Like 비율",
    "총 Comments 비율", "일반 Comments 비율", "광고 Comments 비율",
    "광고 최고 재생수", "광고 최고 게시물 URL", "평균 영상 길이(초)",
]

# 열 인덱스 (gspread 1-based)
COL_NAME = 1   # A
COL_URL  = 2   # B
COL_DATE = 3   # C (실행일, 값 있으면 스킵)
COL_METRICS_START = 3  # C부터 지표 시작 (실행일 포함)


def _get_worksheet() -> gspread.Worksheet:
    client = gspread.oauth(
        credentials_filename=OAUTH_CREDENTIALS_PATH,
        authorized_user_filename=OAUTH_CREDENTIALS_PATH.replace("oauth_credentials.json", ".oauth_token.json"),
    )
    try:
        ws = client.open_by_key(SPREADSHEET_ID).worksheet(SHEET_NAME)
    except WorksheetNotFound:
        raise RuntimeError(f"'{SHEET_NAME}' 시트를 찾을 수 없습니다. 시트를 먼저 만들어주세요.")
    return ws


def _ensure_headers(ws: gspread.Worksheet) -> None:
    """1행 헤더가 없으면 자동 작성 (A1~B1 입력 헤더 + C1~ 지표 헤더)."""
    row1 = ws.row_values(1)
    if not row1 or not row1[0]:
        ws.update("A1:B1", [["채널명", "URL"]])
    if len(row1) < COL_DATE or not (row1[COL_DATE - 1] if len(row1) >= COL_DATE else ""):
        ws.update(_col_range(1, len(METRIC_HEADERS)), [METRIC_HEADERS])


def load_pending_influencers() -> tuple[gspread.Worksheet, list[dict]]:
    """
    C열이 비어있는 행만 반환.
    반환: (worksheet, [{"name": ..., "url": ..., "row": N}, ...])
    """
    ws = _get_worksheet()
    _ensure_headers(ws)

    all_values = ws.get_all_values()
    pending = []
    for i, row in enumerate(all_values[1:], start=2):  # 2행부터 (1행은 헤더)
        name = row[0].strip() if len(row) > 0 else ""
        url  = row[1].strip() if len(row) > 1 else ""
        date = row[2].strip() if len(row) > 2 else ""
        if name and url and not date:
            pending.append({"name": name, "url": url, "row": i})

    return ws, pending


_GRAY_BG  = {"backgroundColor": {"red": 0.87, "green": 0.87, "blue": 0.87}}
_WHITE_BG = {"backgroundColor": {"red": 1.0,  "green": 1.0,  "blue": 1.0}}


def write_row_result(ws: gspread.Worksheet, row: int, metrics: dict) -> None:
    """한 행에 실행일 + 지표 일괄 기재. '-' 값 셀은 회색 배경 처리."""
    today = datetime.now().strftime("%Y-%m-%d")
    values = [today] + [_cell_value(metrics.get(h, "-")) for h in METRIC_HEADERS[1:]]
    ws.update(_col_range(row, len(values)), [values], value_input_option="USER_ENTERED")
    ws.batch_format([
        {
            "range": f"{_col_letter(COL_METRICS_START + i)}{row}",
            "format": _GRAY_BG if val == "-" else _WHITE_BG,
        }
        for i, val in enumerate(values)
    ])


def _cell_value(v):
    if isinstance(v, (int, float)):
        return v
    if v is None:
        return "-"
    return str(v)


def _col_range(row: int, count: int) -> str:
    """C{row}:X{row} 형태의 범위 문자열 반환."""
    start_col = "C"
    end_col = _col_letter(COL_METRICS_START + count - 1)
    return f"{start_col}{row}:{end_col}{row}"


def _col_letter(col_index: int) -> str:
    """1-based 열 번호 → 알파벳 변환 (최대 ZZ)."""
    result = ""
    while col_index > 0:
        col_index, remainder = divmod(col_index - 1, 26)
        result = chr(65 + remainder) + result
    return result
