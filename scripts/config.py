import os
from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, ".env"))

# Google Sheets
OAUTH_CREDENTIALS_PATH = os.getenv(
    "GOOGLE_SHEETS_OAUTH_CREDENTIALS_PATH",
    os.path.join(BASE_DIR, "oauth_credentials.json")
)
SPREADSHEET_ID = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID")
SHEET_NAME = os.getenv("GOOGLE_SHEETS_SHEET_NAME", "시딩 후보 리스트")

# Apify
APIFY_API_TOKEN = os.getenv("APIFY_API_TOKEN")
APIFY_ACTOR_ID = "apify/instagram-scraper"
APIFY_YOUTUBE_ACTOR_ID = os.getenv("APIFY_YOUTUBE_ACTOR_ID", "streamers/youtube-scraper")
APIFY_RESULTS_LIMIT = 60   # 계정당 수집할 최대 게시물 수 (1개월치 여유분 포함)

# 스크리닝 기준
SCREENING_DAYS = 30  # 최근 n일 게시물을 지표 산출에 사용

# 50만뷰 키워드 목록 (캠페인마다 수정)
KEYWORDS_500K = [
    "바닐라빈",
    "딸기주물럭",
]

# 출력
OUTPUT_DIR = os.path.join(BASE_DIR, "data/output")


if __name__ == "__main__":
    print("=== 설정값 확인 ===")
    print(f"OAUTH_CREDENTIALS_PATH : {OAUTH_CREDENTIALS_PATH}")
    print(f"SPREADSHEET_ID   : {SPREADSHEET_ID}")
    print(f"SHEET_NAME       : {SHEET_NAME}")
    print(f"APIFY_API_TOKEN  : {'설정됨' if APIFY_API_TOKEN else '미설정'}")
    print(f"KEYWORDS_500K    : {KEYWORDS_500K}")
    print(f"SCREENING_DAYS   : {SCREENING_DAYS}일")
