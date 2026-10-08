#!/usr/bin/env python3
"""Build a bounded, public-field-only snapshot of botanical Places in Japan."""
import argparse
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
import difflib
import hashlib
import json
import math
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit, urlunsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
RELEASE = '2026-09-23.1'
CATEGORIES = {'flowers_and_gifts_store', 'florist', 'nursery_and_gardening_store', 'botanical_garden'}
CATEGORIES.update({'park', 'hiking_trail', 'national_park', 'nature_reserve', 'forest', 'state_park', 'farm', 'urban_farm'})
PREFECTURES = '北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split()
ROMAJI = 'hokkaido aomori iwate miyagi akita yamagata fukushima ibaraki tochigi gunma saitama chiba tokyo kanagawa niigata toyama ishikawa fukui yamanashi nagano gifu shizuoka aichi mie shiga kyoto osaka hyogo nara wakayama tottori shimane okayama hiroshima yamaguchi tokushima kagawa ehime kochi fukuoka saga nagasaki kumamoto oita miyazaki kagoshima okinawa'.split()
LICENSES = {'CDLA-Permissive-2.0', 'Apache-2.0', 'CC0-1.0'}
CONTACT = re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|(?:0\d{1,4}[-ー]\d{1,4}[-ー]\d{3,4})')
EXCLUDED_NAME = re.compile(r'閉店|閉業|廃業|移転前|旧店舗|ギフト専門|ギフトショップ|カタログギフト|墓石|葬祭|葬儀|仏壇|仏具|美容|ネイル|歯科|保育|幼稚園|整骨|整体|エステ|住宅展示|ホテル|ラブホテル|リフォーム|株式会社.*建設|廃棄物', re.I)
EXCLUDED_NAME = re.compile(EXCLUDED_NAME.pattern + r'|hair|salon|ヘア|南海部品|工具屋|木材団地|事務所|管理棟|カラオケ|まねきねこ|居酒屋|焼肉|焼鳥|ラーメン|洋菓子|和菓子|精肉|焼菓子|セブン.?イレブン|ローソン|ファミリーマート|コンビニ|サンリオ|sanrio|トイザらス|キャンドゥ|ダイソー|パチンコ|ゴルフ|自生地|群生地|希少|絶滅|個人宅|私有地|立入禁止|ミュージアムショップ|駐車場|公衆トイレ|休憩所|案内所|管理事務所|入口|登山口|切花市場', re.I)
EXCLUDED_NAME = re.compile(EXCLUDED_NAME.pattern + r'|マンション|レジデンス|アパート|ハイツ|カーサ.?セレブ|林道|小屋跡|登り口', re.I)
BOTANICAL_NAME = re.compile(r'花|華|フラワ|ふらわ|フローリ|フロリ|flower|flor|fleur|園芸|植木|植物|green|グリーン|緑|種苗|生花|ガーデン|garden|盆栽|蘭|ローズ|rose|bonsai|bouquet|ブーケ|ハーブ|herb|nurser|ナーセリー|観葉|えんげい|はなや|hanaya|苗|鉢|ハナ|jardin|plants|プランツ', re.I)
PARK_NAME = re.compile(r'自然|森林|緑地|緑道|植物|フラワー|ローズ|バラ|ばら|梅林|ハーブ|樹木|花畑|花園|遊歩道|湿原|里山|山野草|国営|県立|都立|庭園|ガーデン|桜|さくら|サクラ|あじさい|アジサイ|紅葉|もみじ|菖蒲|しょうぶ|花菖蒲|椿|ツバキ|城址|城跡')
FARM_NAME = re.compile(r'観光|狩り|イチゴ|いちご|苺|ぶどう|ブドウ|ブルーベリー|果樹園|りんご園|みかん園|梨園|貸農園|体験農園|市民農園|シェア畑')
BOUNDARY_URL = 'https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/9469f09/releaseData/gbOpen/JPN/ADM1/geoBoundaries-JPN-ADM1_simplified.geojson'
BOUNDARY_SHA = 'f18eeeb978d992a7147f636642932913731c231f298cb514bf7a3bd41a1aacc0'

def normalized(value):
    value = re.sub(r'[\W_]+|株式会社|有限会社|合同会社', '', unicodedata.normalize('NFKC', value).lower())
    for latin, japanese in {'aoyamaflowermarket': '青山フラワーマーケット', 'coppicegarden': 'コピスガーデン', 'gardencentersunnyvale': 'ガーデンセンターさにべる', 'floristhanakiya': '花木屋', 'kojimagarden': '小島ガーデン', 'inagakiflorist': '稲垣生花店'}.items():
        value = value.replace(latin, japanese)
    return value

def prefecture(address):
    region = address.get('region') or ''
    for p in PREFECTURES:
        if p == region or p in (address.get('freeform') or ''):
            return p
    for i, (p, latin) in enumerate(zip(PREFECTURES, ROMAJI), 1):
        if normalized(region) in {normalized(p), normalized(p[:-1]), latin, f'jp{i:02}', f'{i:02}'}:
            return p
    return None

def website(urls):
    for raw in urls or []:
        try:
            u = urlsplit(raw)
            if u.scheme != 'https' or not u.hostname or '.' not in u.hostname or u.username or u.password or u.port or re.match(r'^(localhost|127\.|0\.|\[)', u.hostname):
                continue
            # Remove tracking queries and fragments; never retain credentials,
            # contact fields or per-user URL parameters from source records.
            safe = urlunsplit((u.scheme, u.netloc, u.path, '', ''))
            if len(safe) <= 350 and not CONTACT.search(safe) and not re.search('/' + r'(?:users|home)/', safe, re.I):
                return safe
        except ValueError:
            pass
    return None

def distance(a, b):
    return math.hypot((a['lat'] - b['lat']) * 111320, (a['lon'] - b['lon']) * 111320 * math.cos(math.radians(a['lat'])))

def fetch_candidates(output, scratch):
    import duckdb
    collection = f'https://stac.overturemaps.org/{RELEASE}/places/place/collection.json'
    with urlopen(collection, timeout=30) as response:
        links = json.load(response)['links']
    files = []
    for link in links:
        if link['rel'] != 'item':
            continue
        with urlopen(link['href'], timeout=30) as response:
            item = json.load(response)
        west, south, east, north = item['bbox']
        if west <= 154 and east >= 122 and south <= 46 and north >= 20:
            files.append(item['assets']['aws']['href'])
    if not 1 <= len(files) <= 4:
        raise ValueError('Unexpected spatial partition count; review before fetching')
    scratch.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute('SET extension_directory=?', [str(scratch / 'extensions')])
    con.execute('INSTALL httpfs'); con.execute('LOAD httpfs')
    con.execute('SET threads=4'); con.execute("SET memory_limit='512MB'")
    con.execute('SET temp_directory=?', [str(scratch / 'temp')])
    con.execute('SET http_timeout=45'); con.execute('SET http_retries=1')
    query = """SELECT id, names.primary AS "name", taxonomy.primary AS category,
        bbox.xmin AS lon, bbox.ymin AS lat, confidence, websites, addresses,
        list_transform(sources, s -> {'dataset': s.dataset, 'license': s.license}) AS providers
        FROM read_parquet(?) WHERE bbox.xmin BETWEEN 122 AND 154
        AND bbox.ymin BETWEEN 20 AND 46 AND addresses[1].country='JP'
        AND confidence >= 0.7 AND (
            taxonomy.primary IN ('flowers_and_gifts_store','florist','nursery_and_gardening_store','botanical_garden','hiking_trail','national_park','nature_reserve','forest','state_park')
            OR (taxonomy.primary='park' AND regexp_matches(names.primary, ?))
            OR (taxonomy.primary IN ('farm','urban_farm') AND regexp_matches(names.primary, ?)))
        AND (operating_status IS NULL OR operating_status NOT IN ('permanently_closed','temporarily_closed','closed'))
        LIMIT 30001"""
    cursor = con.execute(query, [files, PARK_NAME.pattern, FARM_NAME.pattern])
    fields = [d[0] for d in cursor.description]
    rows = [dict(zip(fields, row)) for row in cursor.fetchall()]
    if len(rows) > 30000:
        raise ValueError('Candidate limit exceeded; review source scope')
    output.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
    con.close()

def build(candidates, minimum_confidence, total, boundaries):
    from shapely.geometry import shape, Point
    from shapely.strtree import STRtree
    boundary_bytes = boundaries.read_bytes()
    if hashlib.sha256(boundary_bytes).hexdigest() != BOUNDARY_SHA:
        raise ValueError('Boundary source does not match pinned release')
    features = json.loads(boundary_bytes)['features']
    tree = STRtree([shape(f['geometry']) for f in features])
    pref_names = [PREFECTURES[int(f['properties']['shapeISO'][3:]) - 1] for f in features]
    manual = json.loads((ROOT / 'site/data/catalog.json').read_text())
    japanese_places = defaultdict(list)
    outdoor = {'botanical_garden', 'hiking_trail', 'national_park', 'nature_reserve', 'forest', 'state_park'}
    for r in candidates:
        if r['category'] in outdoor and (r.get('confidence') or 0) >= minimum_confidence and re.search('[一-龠ぁ-んァ-ヶ]', r.get('name') or '') and not EXCLUDED_NAME.search(r['name']):
            japanese_places[(round(r['lat'] * 500), round(r['lon'] * 500))].append(r)
    candidates = sorted(candidates, key=lambda r: (-(r.get('confidence') or 0), r['id']))
    rejected = Counter(); kept = []; buckets = defaultdict(list); provider_groups = []
    for f in manual['facilities']:
        r = dict(f, **f['location']); buckets[(round(r['lat'] * 500), round(r['lon'] * 500))].append(r)
    for r in candidates:
        name = (r.get('name') or '').strip()
        address = next((a for a in (r.get('addresses') or []) if a.get('country') == 'JP'), {})
        explicit_pref = prefecture(address)
        matches = tree.query(Point(r['lon'], r['lat']), predicate='within')
        pref = pref_names[matches[0]] if len(matches) == 1 else explicit_pref
        if explicit_pref and pref != explicit_pref:
            rejected['prefecture_conflict'] += 1; continue
        if not pref or r.get('category') not in CATEGORIES or not (r.get('confidence') or 0) >= minimum_confidence:
            rejected['region_category_confidence'] += 1; continue
        if not 2 <= len(name) <= 160 or CONTACT.search(name) or EXCLUDED_NAME.search(name):
            rejected['name'] += 1; continue
        if r['category'] == 'botanical_garden' and not (BOTANICAL_NAME.search(name) or re.search(r'園|庭|菖蒲|あじさい|椿|野草|薬草|botanic|arboret', name, re.I)):
            rejected['botanical_relevance'] += 1; continue
        if r['category'] in outdoor and not re.search('[一-龠ぁ-んァ-ヶ]', name):
            cell = (round(r['lat'] * 500), round(r['lon'] * 500))
            nearby = [other for dx in range(-2, 3) for dy in range(-2, 3) for other in japanese_places[(cell[0] + dx, cell[1] + dy)] if r['category'] == other['category'] and distance(r, other) < 150]
            if nearby:
                rejected['nearby_translated_record'] += 1; continue
        if (r['category'] in {'farm', 'urban_farm'} and not re.search(r'観光|狩り|貸農園|体験農園|市民農園|シェア畑|直売|摘み', name)):
            rejected['visit_purpose_unconfirmed'] += 1; continue
        if (r['category'] == 'flowers_and_gifts_store' and not BOTANICAL_NAME.search(name)) or (r['category'] == 'nursery_and_gardening_store' and not BOTANICAL_NAME.search(name) and not re.search(r'コメリ|カインズ|ビバホーム|ナフコ|コーナン|ジョイフル本田|ＤＣＭ|DCM|JA.*アグリ|ＪＡ.*アグリ', name, re.I)) or (r['category'] == 'park' and not PARK_NAME.search(name)) or (r['category'] in {'farm', 'urban_farm'} and not FARM_NAME.search(name)):
            rejected['botanical_relevance'] += 1; continue
        if not 20 <= r['lat'] <= 46 or not 122 <= r['lon'] <= 154:
            rejected['coordinate'] += 1; continue
        providers = sorted({(p['dataset'], p['license']) for p in r['providers']})
        if not providers or any(license not in LICENSES for _, license in providers):
            rejected['license'] += 1; continue
        name_key = normalized(name)
        cell = (round(r['lat'] * 500), round(r['lon'] * 500)); duplicate = False
        for dx in range(-2, 3):
            for dy in range(-2, 3):
                for other in buckets[(cell[0] + dx, cell[1] + dy)]:
                    other_key = normalized(other['name']); meters = distance(r, other)
                    similar = name_key == other_key or (min(len(name_key), len(other_key)) >= 4 and (name_key in other_key or other_key in name_key)) or difflib.SequenceMatcher(None, name_key, other_key).ratio() >= .83
                    if meters < 200 and similar:
                        duplicate = True; break
                if duplicate: break
            if duplicate: break
        if duplicate:
            rejected['duplicate'] += 1; continue
        group = [{'dataset': dataset, 'license': license} for dataset, license in providers]
        if group not in provider_groups:
            provider_groups.append(group)
        city = (address.get('locality') or '').strip()
        if len(city) > 100 or CONTACT.search(city):
            rejected['city'] += 1; continue
        item = dict(id=r['id'], name=name, prefecture=pref, city=city, category=r['category'], lat=round(r['lat'], 6), lon=round(r['lon'], 6), url=website(r.get('websites')), confidence=round(r['confidence'], 4), source=provider_groups.index(group))
        kept.append(item); buckets[cell].append(item)
    # Round-robin across prefecture/category groups retains nationwide diversity;
    # within a group the source existence score is descending. No ranking claim.
    groups = defaultdict(deque)
    for r in kept:
        groups[(r['prefecture'], r['category'])].append(r)
    selected = []; needed = total - len(manual['facilities'])
    while len(selected) < needed and any(groups.values()):
        for key in sorted(groups):
            if groups[key] and len(selected) < needed:
                selected.append(groups[key].popleft())
    if len(selected) != needed or set(r['prefecture'] for r in selected) != set(PREFECTURES):
        raise ValueError(f'Insufficient qualified nationwide records: {len(selected)}; rejected={dict(rejected)}')
    selected.sort(key=lambda r: (PREFECTURES.index(r['prefecture']), r['category'], r['name'], r['id']))
    result = dict(schema_version=1, release=RELEASE, retrieved_at=datetime.now(timezone.utc).isoformat(timespec='seconds'), count=len(selected), minimum_confidence=minimum_confidence, geography_source=dict(id='JPN-ADM1-47310658', url=BOUNDARY_URL, sha256=BOUNDARY_SHA, license='ODbL-1.0'), providers=provider_groups, records=selected)
    audit = dict(candidate_count=len(candidates), qualified_count=len(kept), selected_count=len(selected), manual_count=len(manual['facilities']), rejected=dict(rejected), by_prefecture=dict(Counter(r['prefecture'] for r in selected)), by_category=dict(Counter(r['category'] for r in selected)))
    return result, audit

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--candidates', type=Path, required=True)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--additional', type=Path)
    parser.add_argument('--boundaries', type=Path, required=True)
    parser.add_argument('--scratch', type=Path, default=ROOT / '.build/source')
    parser.add_argument('--minimum-confidence', type=float, default=.7)
    parser.add_argument('--total', type=int, default=10000)
    args = parser.parse_args()
    if not .7 <= args.minimum_confidence <= 1 or not 21 <= args.total <= 10000:
        parser.error('Confidence must be >= 0.7; total must be <= 10000')
    if args.fetch:
        fetch_candidates(args.candidates, args.scratch)
    raw = args.candidates.read_bytes(); candidates = json.loads(raw)
    if args.additional:
        additional = args.additional.read_bytes(); candidates.extend(json.loads(additional)); raw += additional
    if len(candidates) > 30000:
        raise ValueError('Candidate limit exceeded')
    data, audit = build(candidates, args.minimum_confidence, args.total, args.boundaries)
    data['selection'] = dict(candidate_count=audit['candidate_count'], qualified_count=audit['qualified_count'], rejected=audit['rejected'], source_sha256=hashlib.sha256(raw).hexdigest())
    encoded = json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n'
    # Only the derived allowlisted fields enter the public tree.
    (ROOT / 'site/data/nationwide.json').write_text(encoded, encoding='utf-8')
    print(json.dumps(audit, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
