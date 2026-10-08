export const PURPOSES = { see: '見る', buy: '買う', learn: '学ぶ', experience: '体験', harvest: '収穫' };
export const ENVIRONMENTS = { outdoor: '屋外', indoor: '屋内', greenhouse: '温室', unknown: '屋内外未確認' };
export const PREFECTURES = '北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県'.split(' ');
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.port && !/^(localhost|\[|\d+\.\d+\.\d+\.\d+$)/.test(u.hostname) && !/\.(local|localhost|internal)$/.test(u.hostname) && u.hostname.includes('.') ? u.href : null; } catch { return null; }
}
const validDate = value => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const fail = message => { throw new Error(message); };
export const IMPORT_CATEGORIES = { flowers_and_gifts_store: ['florist', 'buy'], florist: ['florist', 'buy'], nursery_and_gardening_store: ['garden-center', 'buy'], botanical_garden: ['botanical-garden', 'see'], park: ['nature-trail', 'see'], hiking_trail: ['nature-trail', 'see'], national_park: ['nature-trail', 'see'], nature_reserve: ['nature-trail', 'see'], forest: ['nature-trail', 'see'], state_park: ['nature-trail', 'see'], farm: ['picking-farm', 'see'], urban_farm: ['allotment', 'experience'] };
export function mergeCatalog(manual, bulk) {
  validateCatalog(manual);
  if (bulk.schema_version !== 1 || !/^\d{4}-\d{2}-\d{2}\.\d+$/.test(bulk.release) || !validDate(bulk.retrieved_at) || !Array.isArray(bulk.records) || bulk.records.length > 10000 || !Array.isArray(bulk.providers)) fail('全国データの形式が不正です');
  const ids = new Set(manual.facilities.map(f => f.id));
  const imported = bulk.records.map(r => {
    if (!/^([a-f0-9]{8}-){1}[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(r.id) || ids.has(`ov-${r.id}`) || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 160 || !PREFECTURES.includes(r.prefecture) || typeof r.city !== 'string' || r.city.length > 100 || !IMPORT_CATEGORIES[r.category] || !Number.isFinite(r.lat) || !Number.isFinite(r.lon) || r.lat < 20 || r.lat > 46 || r.lon < 122 || r.lon > 154 || !Number.isFinite(r.confidence) || r.confidence < .7 || r.confidence > 1 || (r.url !== null && !safeUrl(r.url)) || !Number.isInteger(r.source) || !bulk.providers[r.source]) fail('全国データの施設・出典が不正です');
    ids.add(`ov-${r.id}`);
    let [category, purpose] = IMPORT_CATEGORIES[r.category];
    if (['farm', 'urban_farm'].includes(r.category) && /貸農園|体験農園|市民農園|シェア畑/.test(r.name)) { category = 'allotment'; purpose = 'experience'; }
    const purposes = r.category === 'farm' && /狩り|摘み/.test(r.name) ? ['experience', 'harvest'] : [purpose];
    return { id: `ov-${r.id}`, name: r.name, prefecture: r.prefecture, city: r.city, categories: [category], purposes, data_tier: 'open-data', listing_url: r.url, source_record_id: r.id, source_category: r.category, source_providers: bulk.providers[r.source], confidence: r.confidence, location: { lat: r.lat, lon: r.lon }, label_priority: 3, summary: `${r.prefecture}${r.city} · ${manual.categories.find(c => c.id === category).name}` };
  });
  if (bulk.count !== imported.length || !bulk.providers.every(group => Array.isArray(group) && group.length && group.every(p => typeof p.dataset === 'string' && p.dataset.length <= 60 && ['CDLA-Permissive-2.0', 'Apache-2.0', 'CC0-1.0'].includes(p.license)))) fail('全国データの件数・ライセンスが不正です');
  return { ...manual, facilities: [...manual.facilities, ...imported], bulk: { release: bulk.release, retrieved_at: bulk.retrieved_at, count: bulk.count } };
}
function unique(items, label) {
  if (!Array.isArray(items)) fail(`${label}: 配列が必要です`);
  const ids = new Set();
  for (const item of items) {
    if (!item || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(item.id) || ids.has(item.id)) fail(`${label}: IDが不正です`);
    ids.add(item.id);
  }
  return ids;
}
export function validateCatalog(data) {
  if (!data || data.schema_version !== 1 || !validDate(data.generated_at)) fail('データ形式が不正です');
  if (!['ui-preview', 'manual'].includes(data.mode)) fail('データの公開区分が不正です');
  const categories = unique(data.categories, 'ジャンル'), plants = unique(data.plants, '植物');
  const facilities = unique(data.facilities, '施設'), targets = unique(data.targets, '対象');
  unique(data.observations, '現地情報');
  unique(data.seasonal_calendars, '例年の見頃');
  const events = unique(data.events, 'イベント');
  const facilitiesById = new Map(data.facilities.map(f => [f.id, f]));
  if (!Array.isArray(data.forecasts) || data.forecasts.length) fail('未対応の予想情報です');
  if (data.facilities.some(f => f.location?.source_url?.startsWith('https://www.openstreetmap.org/')) && (data.data_license?.url !== 'https://opendatacommons.org/licenses/odbl/1-0/' || !data.data_license?.attribution?.includes('OpenStreetMap contributors'))) fail('施設位置の出典・ライセンス表示が必要です');
  for (const entry of [...data.categories, ...data.plants]) if (typeof entry.name !== 'string' || !entry.name.trim()) fail('名称が必要です');
  for (const f of data.facilities) {
    if (typeof f.name !== 'string' || !f.name.trim() || !PREFECTURES.includes(f.prefecture) || typeof f.city !== 'string') fail('施設の基本情報が不正です');
    if (f.public_access !== true || !safeUrl(f.official_url) || !validDate(f.verified_at)) fail('一般利用・出典の確認が必要です');
    if (!Array.isArray(f.categories) || !f.categories.length || f.categories.some(c => !categories.has(c))) fail('施設ジャンルが不正です');
    if (!Array.isArray(f.purposes) || !f.purposes.length || f.purposes.some(p => !PURPOSES[p])) fail('施設の目的が不正です');
    if (!f.location || !Number.isFinite(f.location.lat) || !Number.isFinite(f.location.lon) || f.location.lat < 20 || f.location.lat > 46 || f.location.lon < 122 || f.location.lon > 154 || !safeUrl(f.location.source_url) || !validDate(f.location.verified_at) || !['entrance', 'site-reference'].includes(f.location.precision)) fail('確認済みの施設座標が必要です');
    if (!Array.isArray(f.sources) || !f.sources.length || f.sources.some(s => !safeUrl(s.url) || !validDate(s.checked_at) || s.use_basis !== 'independently-verified-facts')) fail('施設情報の利用根拠が必要です');
    if (f.summary !== undefined && (typeof f.summary !== 'string' || !f.summary.trim() || f.summary.length > 80)) fail('施設の一言紹介が不正です');
    if (f.features !== undefined && (!Array.isArray(f.features) || !f.features.length || f.features.length > 6 || f.features.some(s => typeof s !== 'string' || !s.trim() || s.length > 200))) fail('施設の特徴が不正です');
    if (f.label_priority !== undefined && ![1, 2, 3].includes(f.label_priority)) fail('地図ラベルの優先度が不正です');
  }
  for (const t of data.targets) {
    if (!facilities.has(t.facility_id) || !plants.has(t.plant_id) || typeof t.area !== 'string' || !t.area.trim() || !ENVIRONMENTS[t.environment] || !Array.isArray(t.purposes) || !t.purposes.length || t.purposes.some(p => !PURPOSES[p])) fail('植物・場所・目的の関係が不正です');
    const f = facilitiesById.get(t.facility_id);
    if (t.purposes.some(p => !f.purposes.includes(p))) fail('施設と対象の目的が矛盾しています');
    if (t.event_id !== undefined && (!events.has(t.event_id) || data.events.find(e => e.id === t.event_id).facility_id !== t.facility_id)) fail('イベントと植物の関係が不正です');
  }
  for (const e of data.events) {
    if (!facilities.has(e.facility_id) || ![e.name, e.venue, e.schedule_note, e.admission_note].every(s => typeof s === 'string' && s.trim() && s.length <= 200) || ![e.starts_at, e.ends_at, e.checked_at].every(validDate) || Date.parse(e.ends_at) <= Date.parse(e.starts_at) || !safeUrl(e.source_url) || e.reviewed !== true || typeof e.cancelled !== 'boolean') fail('イベントの会場・日時・確認が不正です');
  }
  for (const o of data.observations) {
    if (!targets.has(o.target_id) || !['peak', 'flowering', 'starting', 'ending', 'ended', 'unknown'].includes(o.status) || ![null, 'seasonal-peak', 'notable-flowering'].includes(o.inclusion_reason)) fail('現地情報の関係・状態が不正です');
    if (![o.observed_at, o.published_at, o.valid_from, o.valid_until].every(validDate) || !safeUrl(o.source_url) || !['official', 'operator-observation'].includes(o.source_type) || o.reviewed !== true || typeof o.viewable !== 'boolean' || typeof o.withdrawn !== 'boolean') fail('現地情報の日時・確認が必要です');
    if (Date.parse(o.valid_until) <= Date.parse(o.valid_from) || Date.parse(o.observed_at) > Date.parse(o.published_at) || Date.parse(o.observed_at) > Date.parse(o.valid_from)) fail('現地情報の時系列が不正です');
  }
  for (const season of data.seasonal_calendars) {
    if (!targets.has(season.target_id) || season.basis !== 'typical-season' || !safeUrl(season.source_url) || !validDate(season.checked_at)) fail('例年の見頃の対象・根拠が不正です');
    if (!Array.isArray(season.periods) || !season.periods.length || season.periods.length > 4 || season.periods.some(p => typeof p.label !== 'string' || !p.label.trim() || p.label.length > 20 || typeof p.description !== 'string' || !p.description.trim() || p.description.length > 100)) fail('例年の見頃の時期が不正です');
  }
  return data;
}
export function currentObservations(data, now = Date.now()) {
  return data.observations.filter(o => o.reviewed && o.viewable && !o.withdrawn && Date.parse(o.observed_at) <= now && Date.parse(o.published_at) <= now && Date.parse(o.valid_from) <= now && now < Date.parse(o.valid_until) && ((o.status === 'peak' && o.inclusion_reason === 'seasonal-peak') || (o.status === 'flowering' && o.inclusion_reason === 'notable-flowering')));
}
export function eventStatus(event, now = Date.now()) {
  if (event.cancelled) return 'cancelled';
  if (now < Date.parse(event.starts_at)) return 'scheduled';
  return now < Date.parse(event.ends_at) ? 'active' : 'ended';
}
const matchesEnvironment = (actual, filter) => !filter || actual === filter || (filter === 'indoor' && actual === 'greenhouse');
const normalize = value => value.normalize('NFKC').toLocaleLowerCase('ja').replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
const indexes = new WeakMap();
const genreWords = { florist: '花店 生花店 お花屋 フローリスト フロリスト flower shop', 'garden-center': '園芸 園芸店 ガーデニング garden center', 'botanical-garden': '植物園 温室 botanical garden', 'nature-trail': '自然観察 散策 公園 緑地 遊歩道', 'picking-farm': '観光農園 果樹園', allotment: '体験農園 市民農園 貸農園' };
function indexFor(data) {
  if (indexes.has(data)) return indexes.get(data);
  const targets = new Map(), plants = new Map(data.plants.map(p => [p.id, p.name]));
  for (const t of data.targets) { if (!targets.has(t.facility_id)) targets.set(t.facility_id, []); targets.get(t.facility_id).push(t); }
  const texts = new Map(data.facilities.map(f => [f.id, normalize([f.name, f.prefecture, f.city, ...(f.aliases || []), ...f.categories.map(id => `${data.categories.find(c => c.id === id)?.name || ''} ${genreWords[id] || ''}`), ...(targets.get(f.id) || []).map(t => plants.get(t.plant_id) || '')].join(' '))]));
  const index = { targets, texts, events: new Map(data.events.map(e => [e.id, e])) }; indexes.set(data, index); return index;
}
export function searchCatalog(data, filters = {}, now = Date.now()) {
  const words = normalize(filters.query || '').trim().split(/\s+/).filter(Boolean), index = indexFor(data);
  const purposes = filters.purposes || [];
  const current = currentObservations(data, now);
  return data.facilities.flatMap(f => {
    if (filters.prefecture && f.prefecture !== filters.prefecture) return [];
    if (filters.category && !f.categories.includes(filters.category)) return [];
    if (filters.verified && f.data_tier === 'open-data') return [];
    if (purposes.length && !purposes.some(p => f.purposes.includes(p))) return [];
    if (words.length && !words.every(word => index.texts.get(f.id).includes(word))) return [];
    const allTargets = (index.targets.get(f.id) || []).filter(t => !t.event_id || ['scheduled', 'active'].includes(eventStatus(index.events.get(t.event_id), now)));
    const matchedTargets = allTargets.filter(t => (!filters.plant || t.plant_id === filters.plant) && matchesEnvironment(t.environment, filters.environment) && (!purposes.length || purposes.some(p => t.purposes.includes(p))));
    const records = current.filter(o => matchedTargets.some(t => t.id === o.target_id));
    if (filters.peak && !records.length) return [];
    if (!filters.peak && (filters.plant || filters.environment) && !matchedTargets.length) return [];
    return [{ facility: f, targets: matchedTargets, observations: records }];
  });
}

// Aggregate visible candidates before creating DOM markers. No facility is
// dropped from search counts. The selected facility always remains clickable.
export function mapClusterPlan(points, zoom, size, selectedId = null) {
  const groups = new Map(), singles = [];
  const cell = Math.max(zoom >= 15 ? 38 : 64, Math.ceil(Math.sqrt(size.x * size.y / 180)));
  for (const point of points) {
    if (point.x < 0 || point.y < 0 || point.x > size.x || point.y > size.y) continue;
    if (point.facility.id === selectedId || (zoom >= 7 && point.facility.label_priority === 1)) { singles.push({ points: [point], x: point.x, y: point.y }); continue; }
    const key = `${Math.floor(point.x / cell)}/${Math.floor(point.y / cell)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(point);
  }
  const clustered = [...groups.values()].map(items => ({ points: items, x: items.reduce((n, p) => n + p.x, 0) / items.length, y: items.reduce((n, p) => n + p.y, 0) / items.length }));
  // Adjacent cells can have centroids at the same edge. Merge overlapping
  // bubbles as well, so their counts stay readable without dropping records.
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let i = 0; i < clustered.length; i++) {
      for (let j = i + 1; j < clustered.length; j++) {
        const a = clustered[i], b = clustered[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) >= 50) continue;
        const count = a.points.length + b.points.length;
        a.x = (a.x * a.points.length + b.x * b.points.length) / count;
        a.y = (a.y * a.points.length + b.y * b.points.length) / count;
        a.points.push(...b.points); clustered.splice(j, 1); changed = true; break outer;
      }
    }
  }
  return [...singles, ...clustered];
}

// Count each facet with the other conditions retained, so users can see
// what is available before choosing or changing that condition.
export function facetCounts(data, filters = {}, now = Date.now()) {
  const counts = {
    prefecture: Object.fromEntries(PREFECTURES.map(p => [p, 0])),
    category: Object.fromEntries(data.categories.map(c => [c.id, 0])),
    plant: Object.fromEntries(data.plants.map(p => [p.id, 0])),
    environment: Object.fromEntries(Object.keys(ENVIRONMENTS).map(e => [e, 0])),
    purposes: Object.fromEntries(Object.keys(PURPOSES).map(p => [p, searchCatalog(data, { ...filters, purposes: [p] }, now).length])),
    peak: searchCatalog(data, { ...filters, peak: true }, now).length,
  };
  for (const { facility } of searchCatalog(data, { ...filters, prefecture: '' }, now)) counts.prefecture[facility.prefecture]++;
  for (const { facility } of searchCatalog(data, { ...filters, category: '' }, now)) for (const id of facility.categories) counts.category[id]++;
  for (const facet of ['plant', 'environment']) {
    for (const result of searchCatalog(data, { ...filters, [facet]: '' }, now)) {
      const currentIds = new Set(result.observations.map(o => o.target_id));
      const targets = result.targets.filter(t => !filters.peak || currentIds.has(t.id));
      const values = new Set(targets.flatMap(t => facet === 'plant' ? [t.plant_id] : t.environment === 'greenhouse' ? ['greenhouse', 'indoor'] : [t.environment]));
      for (const value of values) counts[facet][value]++;
    }
  }
  return counts;
}

// Editorial priority changes label visibility only, never search results.
// Keep labels inside the map and give prominent facilities first use of space.
export function mapMarkerPlan(points, zoom, size, selectedId = null) {
  const kept = [], spacing = zoom >= 14 ? 0 : zoom >= 12 ? 28 : zoom >= 9 ? 44 : 60;
  for (const point of [...points].sort((a, b) => Number(b.facility.id === selectedId) - Number(a.facility.id === selectedId) || (a.facility.label_priority || 3) - (b.facility.label_priority || 3) || a.facility.id.localeCompare(b.facility.id))) {
    if (point.x < -20 || point.y < -20 || point.x > size.x + 20 || point.y > size.y + 20) continue;
    if (kept.some(p => Math.hypot(p.x - point.x, p.y - point.y) < spacing)) continue;
    kept.push(point);
  }
  return kept.map(point => point.facility.id);
}
export function mapLabelPlan(points, zoom, size) {
  const labels = [], occupied = [];
  const gap = zoom >= 14 ? 4 : 12;
  for (const point of [...points].sort((a, b) => (a.facility.label_priority || 3) - (b.facility.label_priority || 3) || a.facility.id.localeCompare(b.facility.id))) {
    const { facility: f, x, y } = point, priority = f.label_priority || 3;
    if (zoom < (priority === 1 ? 7 : priority === 2 ? 10 : 12) || x < 0 || y < 0 || x > size.x || y > size.y) continue;
    const tier = zoom >= 13 && f.summary ? 2 : 1;
    const width = tier === 2 ? 232 : Math.min(200, Math.max(100, [...f.name].length * 15 + 24));
    const height = tier === 2 ? 66 : 36, offset = zoom >= 12 ? 22 : 18;
    const direction = x + offset + width <= size.x - 8 ? 'right' : 'left';
    const left = direction === 'right' ? x + offset : x - offset - width;
    const box = { left, right: left + width, top: y - height / 2, bottom: y + height / 2 };
    if (box.left < 8 || box.right > size.x - 8 || box.top < 8 || box.bottom > size.y - 8) continue;
    if (occupied.some(b => box.left < b.right + gap && box.right > b.left - gap && box.top < b.bottom + gap && box.bottom > b.top - gap)) continue;
    occupied.push(box); labels.push({ id: f.id, tier, direction, width });
  }
  return labels;
}
