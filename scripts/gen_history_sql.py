"""
협찬 모니터링 채널별 조회수 히스토리 SQL 생성
account_name + posted_at 으로 sponsored_posts를 찾아 post_daily_stats에 upsert
"""

DATES = ['2026-05-17','2026-05-18','2026-05-19','2026-05-20','2026-05-21',
         '2026-05-22','2026-05-23','2026-05-24','2026-05-25','2026-05-26',
         '2026-05-27','2026-05-28','2026-05-29','2026-05-30','2026-05-31']

# (account_name, posted_at, {measured_at: play_count})
# measured_at 인덱스: 0=5/17, 1=5/18, ... 14=5/31
def d(vals):
    return {DATES[i]: v for i, v in enumerate(vals) if v is not None}

rows = [
    # 영문 계정
    ('365_hot',             '2026-05-19', d([None,None,35000,37000,38000,None,None,None,39000,39621,39638,39733,None,None,40000])),
    ('365_hot',             '2026-05-20', d([None,None,None,31000,33000,None,None,None,35000,35537,35569,35748,None,None,36000])),
    ('365_hot (실시간 예능)','2026-05-22', d([None,None,None,None,None,None,None,None,26000,26000,26637,26755,None,None,27000])),
    ('365_hot',             '2026-05-24', d([None,None,None,None,None,None,None,None,52000,52000,52279,52380,None,None,52000])),
    ('365_real',            '2026-05-19', d([None,None,27000,27000,28000,None,None,None,28000,28761,28772,28806,None,None,28000])),
    ('365_real',            '2026-05-22', d([None,None,None,None,None,None,None,None,21000,21891,21911,22002,None,None,22000])),
    ('365_real',            '2026-05-24', d([None,None,None,None,None,None,None,None,42000,43159,43205,43467,None,None,44000])),
    ('486__humor',          '2026-05-22', d([None,None,None,None,None,None,None,None,14000,15092,15160,16212,None,None,17000])),
    ('486__humor',          '2026-05-23', d([None,None,None,None,None,None,None,None,18000,20145,20318,22089,None,None,23000])),
    ('486__humor',          '2026-05-24', d([None,None,None,None,None,None,None,None,29000,39000,40771,44125,None,None,48000])),
    ('Pangpang_one_',       '2026-05-22', d([None,None,None,None,None,None,None,None,30000,30735,30806,31168,None,None,32000])),
    ('Ufo_NIGHT',           '2026-05-21', d([None,None,None,None,None,None,None,None,57000,57940,57972,58049,None,None,58000])),
    ('Ufo_NIGHT',           '2026-05-23', d([None,None,None,None,None,None,None,None,58000,58793,58827,58923,None,None,59000])),
    ('Ufo_NIGHT',           '2026-05-24', d([None,None,None,None,None,None,None,None,58000,59240,59263,59369,None,None,59000])),
    ('Ufo_ORANGE',          '2026-05-22', d([None,None,None,None,None,None,None,None,59000,60142,60187,60299,None,None,60000])),
    ('Ufo_ORANGE',          '2026-05-23', d([None,None,None,None,None,None,None,None,57000,58336,58359,58484,None,None,58000])),
    ('Ufo_ORANGE',          '2026-05-24', d([None,None,None,None,None,None,None,None,56000,57802,57834,57999,None,None,58000])),
    ('Ufo_RED',             '2026-05-22', d([None,None,None,None,None,None,None,None,59000,59660,59707,59891,None,None,60000])),
    ('Ufo_RED',             '2026-05-23', d([None,None,None,None,None,None,None,None,60000,60914,60959,61106,None,None,61000])),
    ('Ufo_RED',             '2026-05-24', d([None,None,None,None,None,None,None,None,57000,57624,57672,57818,None,None,58000])),
    ('Ufo__NIGHT',          '2026-05-16', d([68000,69000,69000,70000,70000,None,None,None,71000,71128,71147,71210,None,None,71000])),
    ('Ufo__NIGHT',          '2026-05-17', d([31000,58000,58000,58000,58000,None,None,None,59000,59489,59500,59565,None,None,59000])),
    ('Ufo__NIGHT',          '2026-05-19', d([None,None,31000,41000,58000,None,None,None,60000,60431,60462,60539,None,None,60000])),
    ('Ufo__ORANGE',         '2026-05-17', d([66000,71000,73000,74000,75000,None,None,None,77000,78687,78731,78849,None,None,79000])),
    ('Ufo__ORANGE',         '2026-05-19', d([None,None,55000,57000,58000,None,None,None,60000,61467,61489,61565,None,None,61000])),
    ('Ufo__PINK',           '2026-05-16', d([40000,41000,41000,41000,42000,None,None,None,43000,43642,43658,43792,None,None,44000])),
    ('Ufo__RED',            '2026-05-15', d([62000,63000,63000,63000,63000,None,None,None,64000,64145,64156,64243,None,None,64000])),
    ('Ufo__RED',            '2026-05-16', d([71000,72000,73000,73000,73000,None,None,None,74000,74769,74798,74925,None,None,75000])),
    ('Ufo__RED',            '2026-05-19', d([None,None,30000,58000,58000,None,None,None,59000,59488,59499,59600,None,None,60000])),
    ('Ufo__brown',          '2026-05-15', d([30000,30000,30000,30000,31000,None,None,None,31000,31460,31467,31543,None,None,31000])),
    ('Ufo__skyblue',        '2026-05-17', d([29000,30000,32000,34000,35000,None,None,None,37000,38433,38440,38485,None,None,38000])),
    ('Ufo__skyblue',        '2026-05-19', d([None,None,29000,31000,32000,None,None,None,34000,34844,34871,34935,None,None,35000])),
    ('Yes__jam_',           '2026-05-31', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,18753])),
    ('anavocado12345',      '2026-05-29', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,39850])),
    ('apple__paper',        '2026-05-23', d([None,None,None,None,None,None,None,None,31000,31076,31076,31077,None,None,31000])),
    ('bol4_pyeong',         '2026-05-30', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,2046])),
    ('dolkki_gogo',         '2026-05-20', d([None,None,None,2600,3200,None,None,None,3650,3678,3700,3741,None,None,3820])),
    ('dotori_channel',      '2026-05-21', d([None,None,None,None,97000,None,None,None,138000,138031,138031,138043,None,None,138000])),
    ('good_tip_magazine',   '2026-05-23', d([None,None,None,None,None,None,None,None,63000,63813,63829,63879,None,None,63000])),
    ('good_tip_magazine',   '2026-05-24', d([None,None,None,None,None,None,None,None,77000,78154,78168,78213,None,None,78000])),
    ('good_tip_magazine',   '2026-05-29', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,66052])),
    ('hipkr_',              '2026-05-08', d([None,48137,None,None,None,None,None,None,None,None,None,None,None,None,None])),
    ('humani_3',            '2026-05-20', d([None,None,None,5300,7100,None,None,None,8300,8448,8544,8636,None,None,8893])),
    ('humani_3',            '2026-05-21', d([None,None,None,None,3100,None,None,None,4700,4909,4999,5076,None,None,5233])),
    ('humor_yonggari',      '2026-05-21', d([None,None,None,None,13427,None,None,None,25700,35948,39070,39427,None,None,39427])),
    ('humor_yonggari',      '2026-05-28', d([None,None,None,None,None,None,None,None,None,None,None,18483,None,None,38252])),
    ('humor_yonggari',      '2026-05-30', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,20639])),
    ('humor_yonggari',      '2026-05-31', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,17965])),
    ('humorphim',           '2026-05-21', d([None,None,None,None,7696,None,None,None,15151,15521,15765,15945,None,None,15945])),
    ('jolly__humor',        '2026-05-20', d([None,None,None,46000,47000,None,None,None,47000,47000,47788,47841,None,None,47000])),
    ('jolly__humor',        '2026-05-21', d([None,None,None,None,43000,None,None,None,45000,45000,45651,45697,None,None,45000])),
    ('jolly__humor',        '2026-05-29', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,45891])),
    ('kutbba101',           '2026-05-28', d([None,None,None,None,None,None,None,None,None,None,None,15515,None,None,19959])),
    ('lululala_blue',       '2026-05-20', d([None,None,None,7100,9000,None,None,None,10000,11000,11000,11000,None,None,11000])),
    ('mamy014',             '2026-05-20', d([None,None,None,34000,35000,None,None,None,36000,36000,36000,36000,None,None,36000])),
    ('mamy014',             '2026-05-21', d([None,None,None,None,9870,None,None,None,12791,12840,12925,12987,None,None,12987])),
    ('moduhappy',           '2026-05-23', d([None,None,None,None,None,None,None,None,39000,40023,40071,40258,None,None,40000])),
    ('mukddoonge',          '2026-05-28', d([None,None,None,None,None,None,None,None,None,None,None,10724,None,None,21087])),
    ('nato.tip',            '2026-05-30', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,37866])),
    ('nato.zzal',           '2026-05-19', d([None,None,52000,52000,52000,None,None,None,53000,53000,53434,53479,None,None,53000])),
    ('nato.zzal',           '2026-05-30', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,38388])),
    ('oop__snack',          '2026-05-21', d([None,None,None,None,100,None,None,None,10000,10171,10171,10184,None,None,10000])),
    ('oop_snack',           '2026-05-20', d([None,None,None,290,10000,None,None,None,10000,10827,10831,10831,None,None,10000])),
    ('pink_humor25',        '2026-05-21', d([None,None,None,None,1852,None,None,None,3466,3532,3595,3690,None,None,3690])),
    ('seoharung',           '2026-05-29', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,29000])),
    ('smile_haha_S2',       '2026-05-19', d([None,None,33000,34000,34000,None,None,None,35000,35085,35089,35132,None,None,35000])),
    ('smile_haha_S2',       '2026-05-21', d([None,None,None,None,32000,None,None,None,34000,34298,34309,34367,None,None,34000])),
    ('smile_haha_s2',       '2026-05-23', d([None,None,None,None,None,None,None,None,26000,26186,26194,26235,None,None,26000])),
    ('smile_haha_s2',       '2026-05-24', d([None,None,None,None,None,None,None,None,45000,45495,45548,45758,None,None,46000])),
    ('smile_king_s2',       '2026-05-15', d([45000,45000,45000,45000,46000,None,None,None,46000,46344,46355,46425,None,None,46000])),
    ('smile_king_s2',       '2026-05-19', d([None,None,34000,35000,36000,None,None,None,36000,36862,36894,36981,None,None,37000])),
    ('smile_king_s2',       '2026-05-22', d([None,None,None,None,None,None,None,None,35000,35221,35235,35303,None,None,35000])),
    ('smile_king_s2',       '2026-05-23', d([None,None,None,None,None,None,None,None,44000,44541,44604,44911,None,None,45000])),
    ('smile_life_s2',       '2026-05-15', d([43000,44000,44000,44000,44000,None,None,None,44000,44499,44502,44529,None,None,44000])),
    ('smile_life_s2',       '2026-05-17', d([37000,37000,37000,37000,37000,None,None,None,37000,38030,38036,38049,None,None,38000])),
    ('smile_life_s2',       '2026-05-19', d([None,None,30000,31000,31000,None,None,None,31000,31744,31752,31793,None,None,32000])),
    ('smile_life_s2',       '2026-05-22', d([None,None,None,None,None,None,None,None,55000,55380,55391,55428,None,None,55000])),
    ('smile_life_s2',       '2026-05-23', d([None,None,None,None,None,None,None,None,67000,68200,68243,68463,None,None,69000])),
    ('smile_today_s2',      '2026-05-16', d([38000,38000,38000,38000,38000,None,None,None,38000,38260,38268,38311,None,None,38000])),
    ('smile_today_s2',      '2026-05-19', d([None,None,34000,35000,35000,None,None,None,36000,36105,36128,36189,None,None,36000])),
    ('smile_today_s2',      '2026-05-22', d([None,None,None,None,None,None,None,None,34000,34337,34350,34409,None,None,34000])),
    ('smile_today_s2',      '2026-05-23', d([None,None,None,None,None,None,None,None,50000,50104,50113,50145,None,None,50000])),
    ('smile_today_s2',      '2026-05-24', d([None,None,None,None,None,None,None,None,47000,47439,47478,47634,None,None,47000])),
    ('some2lve',            '2026-05-22', d([None,None,None,None,None,None,None,None,53000,53478,53500,53628,None,None,54000])),
    ('some2lve',            '2026-05-24', d([None,None,None,None,None,None,None,None,64000,66000,66000,67000,None,None,68000])),
    ('teddy_ddori',         '2026-05-29', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,4622])),
    ('text_pyeong',         '2026-05-30', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,13316])),
    ('ufo__gray',           '2026-05-20', d([None,None,None,19000,34000,None,None,None,36000,36733,36769,36866,None,None,37000])),
    ('ufo__orange',         '2026-05-20', d([None,None,None,59000,62000,None,None,None,65000,66366,66399,66596,None,None,67000])),
    ('ufo__pink',           '2026-05-20', d([None,None,None,30000,54000,None,None,None,57000,57675,57726,57957,None,None,58000])),
    ('wikitrip.kr',         '2026-05-29', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,29862])),
    ('yes__jam_',           '2026-05-28', d([None,None,None,None,None,None,None,None,None,None,None,18347,None,None,29349])),
    # 한국어 채널명
    ('감다살 푸드 낋여와요', '2026-05-19', d([None,None,13000,35000,37000,None,None,None,41000,41689,41704,41809,None,None,42000])),
    ('낭이',                '2026-05-27', d([None,None,None,None,None,None,None,None,None,None,28000,78000,None,None,175000])),
    ('냠냠',                '2026-05-28', d([None,None,None,None,None,None,None,None,None,None,None,47000,None,None,100000])),
    ('리뷰하는 푸올이',     '2026-05-14', d([None,None,None,None,None,None,None,None,None,24000,24000,24000,None,None,None])),
    ('리뷰하는 푸올이',     '2026-05-20', d([None,None,None,25000,29000,None,None,None,32000,32520,33000,33287,None,None,33000])),
    ('맛송이신상간식',      '2026-05-17', d([20000,30000,31000,32000,32000,None,None,None,33000,33588,34000,34000,None,None,34000])),
    ('먹여원',              '2026-05-19', d([None,None,14000,20000,21000,None,None,None,23000,24000,24000,25000,None,None,25000])),
    ('박태민',              '2026-05-23', d([None,None,None,None,None,None,None,None,55000,62000,66000,69000,None,None,73000])),
    ('뽀',                  '2026-05-13', d([None,None,None,None,32000,None,None,None,34000,35000,35000,35000,None,None,36000])),
    ('세모간',              '2026-05-16', d([None,None,None,None,None,None,None,None,None,21000,22000,22000,None,None,22000])),
    ('여원맛집',            '2026-05-17', d([133000,258000,270000,273000,276000,None,None,None,282000,283700,285000,288000,None,None,296000])),
    ('오홀',                '2026-05-25', d([None,None,None,None,None,None,None,None,None,12000,17000,18000,None,None,22000])),
    ('와뜨기',              '2026-05-23', d([None,None,None,None,None,None,None,None,45000,57000,63000,66000,None,None,74000])),
    ('이나',                '2026-05-17', d([207000,352000,483000,502000,530000,None,None,None,636000,651000,665000,675000,None,None,699000])),
    ('지지야먹자',          '2026-05-18', d([None,72000,168000,215000,264000,None,None,None,342000,361000,372000,381000,None,None,402000])),
    ('찐빵만두',            '2026-05-23', d([None,None,None,None,None,None,None,None,29000,32000,34000,36000,None,None,40000])),
    ('춘짱이의 먹짱일기',   '2026-05-22', d([None,None,None,None,None,None,None,None,9535,10000,10000,11000,None,None,11000])),
    ('푸드의 먹스타',       '2026-05-20', d([None,None,None,37000,43000,None,None,None,50000,50874,51000,51000,None,None,52000])),
    ('풉스낵',              '2026-05-21', d([None,None,None,None,830,None,None,None,11000,11588,11593,11626,None,None,11000])),
    ('홍지',                '2026-05-18', d([None,101000,167000,185000,197000,None,None,None,230000,234000,237000,239000,None,None,244000])),
    # YouTube
    ('제로비',              '2026-05-27', d([None,None,None,None,None,None,None,None,None,None,810000,1900000,None,None,5140000])),
    ('로즈유',              '2026-05-30', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,26000])),
    ('준맛',                '2026-05-29', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,80000])),
    ('nato.tip',            '2026-05-30', d([None,None,None,None,None,None,None,None,None,None,None,None,None,None,37866])),
]

# SQL 생성
lines = []
lines.append("-- 협찬 모니터링 조회수 히스토리 import")
lines.append("-- account_name + posted_at 으로 sponsored_posts와 매칭")
lines.append("")
lines.append("WITH src AS (SELECT * FROM (VALUES")

values = []
for account, posted_at, date_data in rows:
    for measured_at, play_count in date_data.items():
        values.append(f"  ('{account.replace(chr(39), chr(39)*2)}', '{posted_at}'::date, '{measured_at}'::date, {play_count})")

lines.append(",\n".join(values))
lines.append(") AS t(account_name, posted_at, measured_at, play_count)),")
lines.append("")
lines.append("matched AS (")
lines.append("  SELECT sp.id AS post_id, src.measured_at, MAX(src.play_count) AS play_count")
lines.append("  FROM src")
lines.append("  JOIN sponsored_posts sp")
lines.append("    ON lower(sp.account_name) = lower(src.account_name)")
lines.append("    AND sp.posted_at::date = src.posted_at")
lines.append("  GROUP BY sp.id, src.measured_at")
lines.append(")")
lines.append("INSERT INTO post_daily_stats (post_id, measured_at, play_count)")
lines.append("SELECT post_id, measured_at, play_count FROM matched")
lines.append("ON CONFLICT (post_id, measured_at) DO UPDATE SET play_count = EXCLUDED.play_count;")
lines.append("")
lines.append("-- 매칭되지 않은 계정 확인")
lines.append("WITH src AS (SELECT DISTINCT account_name, posted_at FROM (VALUES")
vals2 = list(set((a, p) for a, p, _ in rows))
lines.append(",\n".join(f"  ('{a.replace(chr(39), chr(39)*2)}', '{p}'::date)" for a, p in vals2))
lines.append(") AS t(account_name, posted_at))")
lines.append("SELECT src.account_name, src.posted_at")
lines.append("FROM src")
lines.append("LEFT JOIN sponsored_posts sp")
lines.append("  ON lower(sp.account_name) = lower(src.account_name)")
lines.append("  AND sp.posted_at::date = src.posted_at")
lines.append("WHERE sp.id IS NULL")
lines.append("ORDER BY src.account_name;")

sql = "\n".join(lines)
with open("history_import.sql", "w", encoding="utf-8") as f:
    f.write(sql)

print(f"생성 완료: {len(values)}개 데이터 포인트")
print("history_import.sql 파일 확인")
