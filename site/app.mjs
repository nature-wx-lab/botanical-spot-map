import { PURPOSES, ENVIRONMENTS, PREFECTURES, safeUrl, validateCatalog, searchCatalog, currentObservations } from './engine.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const option = (value, text) => { const e = node('option', text); e.value = value; return e; };
const japanBounds = [[23.8, 122.7], [45.7, 146.1]];
let catalog, map, tiles, markers, refreshTimer, mapStopped = false;
function setupMap() {
  if (!window.L) { $('map-message').textContent = '地図を起動できません。施設一覧からお探しください。'; return; }
  map = L.map('map', { minZoom: 3, maxZoom: 17, scrollWheelZoom: false, maxBounds: [[17, 115], [49, 160]], maxBoundsViscosity: 0.8 });
  map.fitBounds(japanBounds, { padding: [20, 30] });
  tiles = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { minZoom: 3, maxZoom: 17, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a> · VMAP0' }).addTo(map);
  tiles.on('tileerror', () => { if (!mapStopped) $('map-error').hidden = false; });
  tiles.on('load', () => { if (!mapStopped && document.querySelector('.leaflet-tile-loaded')) $('map-error').hidden = true; });
  markers = L.layerGroup().addTo(map);
  new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('map'));
}
function filters() { return { query: $('query').value, peak: $('peak').checked, prefecture: $('prefecture').value, environment: $('environment').value, category: $('category').value, plant: $('plant').value, purposes: [...document.querySelectorAll('[name=purpose]:checked')].map(e => e.value) }; }
function officialLink(url, label) { const e = node('a', label); const href = safeUrl(url); if (href) { e.href = href; e.target = '_blank'; e.rel = 'noopener noreferrer'; } return e; }
const dateLabel = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(value));
function card(result) {
  const { facility: f, observations, targets } = result;
  const e = node('article', undefined, 'spot-card');
  const title = node('button', f.name); title.type = 'button'; title.addEventListener('click', () => { if (map) map.setView([f.location.lat, f.location.lon], 13); });
  e.append(title, node('p', `${f.prefecture} ${f.city} · ${f.purposes.map(p => PURPOSES[p]).join('・')}`));
  for (const o of observations) {
    const t = targets.find(t => t.id === o.target_id), p = catalog.plants.find(p => p.id === t.plant_id);
    const detail = node('p', `${p.name} · ${o.status === 'peak' ? '見頃' : '注目の開花'} · ${ENVIRONMENTS[t.environment]}／${t.area}`, 'spot-status');
    e.append(detail, node('p', `${dateLabel(o.observed_at)}の現地情報 · ${o.source_type === 'official' ? '施設公式発表' : '運営者の現地確認'}`), officialLink(o.source_url, '開花情報の出典を確認'));
  }
  if (!observations.length) e.append(node('p', '現在の見頃は未確認'));
  e.append(node('p', f.access_note || '営業時間・予約・入場条件は公式サイトでご確認ください。'), node('p', `施設情報の確認：${dateLabel(f.verified_at)} · 位置：${f.location.precision === 'entrance' ? '入口' : '敷地代表点'}`), officialLink(f.official_url, '施設の公式サイト'));
  return e;
}
function render() {
  if (!catalog) return;
  const f = filters(), results = searchCatalog(catalog, f), list = $('result-list');
  list.replaceChildren(); markers?.clearLayers(); $('result-count').textContent = results.length;
  const conditionLabels = [f.peak && 'いま見頃あり', f.prefecture, f.plant && catalog.plants.find(p => p.id === f.plant)?.name, f.category && catalog.categories.find(c => c.id === f.category)?.name, f.environment && ENVIRONMENTS[f.environment], ...f.purposes.map(p => PURPOSES[p]), f.query && 'キーワード'].filter(Boolean);
  $('conditions').textContent = conditionLabels.join('・') || '全スポット';
  if (!results.length) {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h3', catalog.facilities.length ? '条件に合う登録情報がありません' : '施設データを順次整備します'));
    empty.append(node('p', catalog.facilities.length ? (f.peak ? '条件に合う有効な見頃情報は登録されていません。見頃ではないという意味ではありません。' : '条件を変更すると、ほかの登録施設を探せます。') : '公式情報を確認した施設から追加します。'));
    list.append(empty);
  }
  for (const result of results) {
    list.append(card(result));
    if (map) {
      const { facility, observations } = result;
      const marker = L.circleMarker([facility.location.lat, facility.location.lon], { radius: 7, weight: 2, color: '#fff', fillColor: observations.length ? '#b96925' : '#226a4a', fillOpacity: 1 });
      const popup = node('div'); popup.append(node('strong', facility.name), node('p', `${facility.prefecture} ${facility.city}`), officialLink(facility.official_url, '公式サイト'));
      marker.bindPopup(popup); marker.bindTooltip(node('span', facility.name)); markers.addLayer(marker);
    }
  }
  if (map) { $('map-message').textContent = !catalog.facilities.length ? '初期公開版 · 施設データを準備中' : results.length ? `${results.length}施設を表示 · ピンを選ぶと詳細` : 'この条件の登録情報はありません'; }
  const count = new Set(currentObservations(catalog).map(o => catalog.targets.find(t => t.id === o.target_id).facility_id)).size;
  $('data-status').textContent = `登録 ${catalog.facilities.length}施設 · 有効な見頃 ${count}施設 · データ版 ${dateLabel(catalog.generated_at)}`;
}
for (const p of PREFECTURES) $('prefecture').append(option(p, p));
$('search').addEventListener('submit', e => e.preventDefault());
$('search').addEventListener('input', render);
$('search').addEventListener('change', render);
$('reset-filters').addEventListener('click', () => { $('search').reset(); render(); });
$('show-japan').addEventListener('click', () => { if (map) map.fitBounds(japanBounds, { padding: [20, 30] }); $('about').close(); });
$('map-stop').addEventListener('click', () => { if (!map || !tiles) return; mapStopped = !mapStopped; if (mapStopped) map.removeLayer(tiles); else tiles.addTo(map); $('map-stop').textContent = mapStopped ? '地図通信を再開' : '地図通信を停止'; $('map-stop').setAttribute('aria-pressed', String(mapStopped)); $('map-error').hidden = true; });
$('about-open').addEventListener('click', () => $('about').showModal());
$('about-close').addEventListener('click', () => $('about').close());
setupMap();
try {
  const response = await fetch('./data/catalog.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error('公開データを取得できません');
  catalog = validateCatalog(await response.json());
  for (const c of catalog.categories) $('category').append(option(c.id, c.name));
  for (const p of catalog.plants) $('plant').append(option(p.id, p.name));
  render();
  refreshTimer = setInterval(render, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  window.addEventListener('pageshow', render);
} catch {
  $('result-list').replaceChildren(node('p', '施設情報を読み込めません。時間をおいて再読み込みしてください。'));
  $('data-status').textContent = '公開データの取得・形式確認に失敗しました';
  if (map) $('map-message').textContent = '施設情報を読み込めません';
}
