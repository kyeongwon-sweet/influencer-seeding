from __future__ import annotations
import os
from supabase import create_client, Client
from config import BASE_DIR
from dotenv import load_dotenv

load_dotenv(os.path.join(BASE_DIR, ".env"))

_client: Client | None = None


def get_client() -> Client:
    global _client
    if _client is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL 또는 SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.")
        _client = create_client(url, key)
    return _client
