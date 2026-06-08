#!/usr/bin/env python3
"""
6/6, 6/7 검색량 데이터 복구 스크립트
Naver Trends API를 사용하여 누락된 날짜의 데이터를 다시 수집합니다.
"""

import os
import json
import requests
from datetime import datetime
from db import get_client

# Naver API 설정
NAVER_CLIENT_ID = os.getenv("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET")

# 기준점 설정 (모니터링 페이지의 설정과 동일)
REF_DATE = "2026-05-31"
REF_LS_ACTUAL = 3748
FALLBACK_BASE = 1326.173

def get_search_volume(keyword: str, start_date: str, end_date: str) -> dict:
    """Naver Trends API에서 검색량 데이터 조회"""

    # REF_DATE가 쿼리 범위에 포함되도록 보정
    q_start = start_date if start_date < REF_DATE else REF_DATE
    q_end = end_date if end_date > REF_DATE else REF_DATE

    headers = {
        "Content-Type": "application/json",
        "X-Naver-Client-Id": NAVER_CLIENT_ID,
        "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
    }

    body = {
        "startDate": q_start,
        "endDate": q_end,
        "timeUnit": "date",
        "keywordGroups": [
            {"groupName": keyword, "keywords": [keyword]}
        ]
    }

    print(f"[LOG] Naver API 요청: {keyword} ({q_start} ~ {q_end})")

    response = requests.post(
        "https://openapi.naver.com/v1/datalab/search",
        headers=headers,
        json=body
    )

    if response.status_code != 200:
        print(f"[ERROR] API 요청 실패: {response.status_code}")
        print(f"[ERROR] Response: {response.text}")
        return {}

    data = response.json()
    if "results" not in data or len(data["results"]) == 0:
        print(f"[WARN] 검색 결과 없음")
        return {}

    # 결과 데이터 추출
    result = data["results"][0]
    volume_by_date = {}

    for item in result["data"]:
        date = item["period"]
        ratio = item["ratio"]

        # 절대값 계산
        if ratio is not None and ratio > 0:
            # FACTOR 계산
            ref_item = next((x for x in result["data"] if x["period"] == REF_DATE), None)
            if ref_item and ref_item["ratio"] > 0:
                factor = REF_LS_ACTUAL / ref_item["ratio"]
            else:
                factor = FALLBACK_BASE

            absolute_volume = ratio * factor
        else:
            absolute_volume = 0

        volume_by_date[date] = {
            "date": date,
            "keyword": keyword,
            "search_volume": int(absolute_volume),
            "measured_at": datetime.now().isoformat()
        }

        print(f"  {date}: {absolute_volume:.0f}")

    return volume_by_date

def recover_data():
    """6/6, 6/7 데이터 복구"""

    print("[LOG] === 검색량 데이터 복구 시작 ===")

    if not NAVER_CLIENT_ID or not NAVER_CLIENT_SECRET:
        print("[ERROR] Naver API 환경변수 설정 필요")
        return

    # 복구할 날짜
    recovery_dates = ["2026-06-06", "2026-06-07"]

    # 복구할 키워드 (라라스윗 기본 키워드)
    keywords = ["라라스윗", "라라스윗 아이스크림"]

    db = get_client()
    all_data = []

    for keyword in keywords:
        print(f"\n[LOG] 키워드: {keyword}")

        # 전체 기간에서 데이터 수집 (정확한 값 확보)
        volume_by_date = get_search_volume(
            keyword,
            "2026-06-01",
            "2026-06-07"
        )

        # 복구 대상 날짜의 데이터만 추출
        for date in recovery_dates:
            if date in volume_by_date:
                all_data.append(volume_by_date[date])
                print(f"  ✅ {date}: {volume_by_date[date]['search_volume']}")
            else:
                print(f"  ❌ {date}: 데이터 없음")

    # Supabase에 저장
    if all_data:
        print(f"\n[LOG] 데이터 저장 중... ({len(all_data)}건)")

        try:
            # 기존 데이터 삭제 (동일 날짜)
            for date in recovery_dates:
                db.table("search_keywords").delete().eq("date", date).execute()
                print(f"  기존 데이터 삭제: {date}")

            # 새 데이터 삽입
            result = db.table("search_keywords").insert(all_data).execute()
            print(f"[SUCCESS] 데이터 저장 완료: {len(result.data)}건")

        except Exception as e:
            print(f"[ERROR] 데이터 저장 실패: {str(e)}")
            raise
    else:
        print("[WARN] 저장할 데이터 없음")

if __name__ == "__main__":
    recover_data()
