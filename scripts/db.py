from __future__ import annotations
import os
from supabase import create_client, Client
from config import BASE_DIR
from dotenv import load_dotenv

# 로컬 .env 파일이 있으면 로드, 없으면 환경변수 사용 (GitHub Actions 호환)
env_path = os.path.join(BASE_DIR, ".env")
if os.path.exists(env_path):
    load_dotenv(env_path)
else:
    load_dotenv()  # 환경변수 우선

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

        # 🔍 상세 진단
        print(f"\n[DEBUG] Supabase 연결 정보:")
        print(f"  URL 설정: {'✅ 설정' if url else '❌ 미설정'}")
        print(f"  URL 길이: {len(url) if url else 0}")
        print(f"  URL 전체값: {url}")
        print(f"  KEY 설정: {'✅ 설정' if key else '❌ 미설정'}")
        print(f"  KEY 길이: {len(key) if key else 0}")
        print(f"  KEY 전체값: {key}")
        print()

        if not url or not key:
            raise RuntimeError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.")

        try:
            print(f"[DEBUG] create_client 시도...")
            _client = create_client(url, key)
            print(f"[DEBUG] ✅ Supabase 연결 성공")
        except Exception as e:
            print(f"[DEBUG] ❌ Supabase 연결 실패: {str(e)}")
            raise

    return _client
