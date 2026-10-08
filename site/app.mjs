import { PURPOSES, ENVIRONMENTS, PREFECTURES, safeUrl, validateCatalog, searchCatalog, currentObservations, facetCounts } from './engine.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const option = (value, text) => { const e = node('option', text); e.value = value; return e; };
const japanBounds = [[23.8, 122.7], [45.7, 146.1]];
let catalog, map, tiles, markers, refreshTimer, mapStopped = false;
function setupMap() {
  if (!window.L) { $('map-message').textContent = '地図を起動できません。施設一覧からお探しください。'; return; }
  map = L.map('map', { minZoom: 3, maxZoom: 17, scrollWheelZoom: true, maxBounds: [[17, 115], [49, 160]], maxBoundsViscosity: 0.8 });
  map.fitBounds(japanBounds, { padding: [20, 30] });
  tiles = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { minZoom: 3, maxZoom: 17, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a> · VMAP0' }).addTo(map);
  tiles.on('tileerror', () => { if (!mapStopped) $('map-error').hidden = false; });
  tiles.on('load', () => { if (!mapStopped && document.querySelector('.leaflet-tile-loaded')) $('map-error').hidden = true; });
  markers = L.layerGroup().addTo(map);
  new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('map'));
}
function filters() { return { query: $('query').value.trim(), peak: $('peak').checked, prefecture: $('prefecture').value, environment: $('environment').value, category: $('category').value, plant: $('plant').value, purposes: [...document.querySelectorAll('[name=purpose]:checked')].map(e => e.value) }; }
const numberLabel = value => value.toLocaleString('ja-JP');
function resetFilters() { $('search').reset(); $('extra-filters').open = false; render(); document.querySelector('.sidebar').scrollTop = 0; }
function updateFilterUI(f, count, now) {
  const counts = facetCounts(catalog, f, now);
  for (const facet of ['prefecture', 'category', 'plant', 'environment']) {
    for (const entry of $(facet).options) {
      if (!entry.value) continue;
      entry.dataset.label ||= entry.textContent;
      entry.textContent = `${entry.dataset.label} (${numberLabel(counts[facet][entry.value])})`;
    }
  }
  for (const key of Object.keys(PURPOSES)) $(`purpose-count-${key}`).textContent = numberLabel(counts.purposes[key]);
  $('peak-count').textContent = `${numberLabel(counts.peak)}件`;
  $('total-count').textContent = `登録 ${numberLabel(catalog.facilities.length)}件から`;
  const chips = $('active-filters'); chips.replaceChildren();
  const addChip = (label, remove) => {
    const button = node('button', undefined, 'filter-chip'); button.type = 'button';
    button.append(node('span', label), node('span', '×', 'chip-close'));
    button.setAttribute('aria-label', `${label}の条件を解除`);
    button.addEventListener('click', () => { remove(); render(); }); chips.append(button);
  };
  if (f.query) addChip(`キーワード：${f.query}`, () => { $('query').value = ''; });
  for (const facet of ['prefecture', 'plant', 'category', 'environment']) if (f[facet]) {
    const label = facet === 'prefecture' ? f[facet] : facet === 'environment' ? ENVIRONMENTS[f[facet]] : catalog[facet === 'plant' ? 'plants' : 'categories'].find(e => e.id === f[facet]).name;
    addChip(label, () => { $(facet).value = ''; });
  }
  for (const purpose of f.purposes) addChip(PURPOSES[purpose], () => { document.querySelector(`[name=purpose][value=${purpose}]`).checked = false; });
  if (f.peak) addChip('いま見頃あり', () => { $('peak').checked = false; });
  const activeCount = chips.childElementCount;
  chips.hidden = activeCount === 0;
  $('reset-filters').disabled = activeCount === 0;
  $('search-guide').textContent = activeCount ? '選択中の条件を押すと、ひとつずつ解除できます' : '条件なし · 登録済みの全施設が対象です';
  $('conditions').textContent = activeCount ? `${activeCount}条件を適用` : '全施設';
  const extraCount = Number(Boolean(f.category)) + Number(Boolean(f.environment));
  $('extra-filter-count').textContent = extraCount ? `(${extraCount})` : '';
  $('result-count').textContent = numberLabel(count);
}
function officialLink(url, label) { const e = node('a', label); const href = safeUrl(url); if (href) { e.href = href; e.target = '_blank'; e.rel = 'noopener noreferrer'; } return e; }
const dateLabel = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(value));
function card(result) {
  const { facility: f, observations, targets } = result;
  const e = node('article', undefined, 'spot-card');
  const details = node('details', undefined, 'spot-detail'); details.append(node('summary', '施設情報・出典を確認'));
  const title = node('button', f.name); title.type = 'button'; title.addEventListener('click', () => { if (map) map.setView([f.location.lat, f.location.lon], 13); });
  e.append(title, node('p', `${f.prefecture} ${f.city} · ${f.purposes.map(p => PURPOSES[p]).join('・')}`));
  for (const o of observations) {
    const t = targets.find(t => t.id === o.target_id), p = catalog.plants.find(p => p.id === t.plant_id);
    e.append(node('p', `${p.name} · ${o.status === 'peak' ? '見頃' : '注目の開花'} · ${ENVIRONMENTS[t.environment]}／${t.area}`, 'spot-status'));
    const source = node('p', `${dateLabel(o.observed_at)}の現地情報 · ${o.source_type === 'official' ? '施設公式発表' : '運営者の現地確認'}`);
    source.append(document.createTextNode(' '), officialLink(o.source_url, '開花情報の出典'));
    details.append(source);
  }
  if (!observations.length) e.append(node('p', '現在の見頃は未確認'));
  details.append(node('p', f.access_note || '営業時間・予約・入場条件は公式サイトでご確認ください。'), node('p', `施設情報の確認：${dateLabel(f.verified_at)} · 位置：${f.location.precision === 'entrance' ? '入口' : '敷地代表点'}`), officialLink(f.official_url, '施設の公式サイト'));
  e.append(details);
  return e;
}
function render() {
  if (!catalog) return;
  const f = filters(), now = Date.now(), results = searchCatalog(catalog, f, now), list = $('result-list');
  list.replaceChildren(); markers?.clearLayers(); updateFilterUI(f, results.length, now);
  if (!results.length) {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h3', catalog.facilities.length ? '条件に合う登録情報がありません' : '施設データを順次整備します'));
    empty.append(node('p', catalog.facilities.length ? (f.peak ? '条件に合う有効な見頃情報は登録されていません。見頃ではないという意味ではありません。' : '条件を変更すると、ほかの登録施設を探せます。') : '公式情報を確認した施設から追加します。'));
    if (catalog.facilities.length) {
      const reset = node('button', 'すべての登録施設に戻す', 'empty-reset'); reset.type = 'button'; reset.addEventListener('click', resetFilters); empty.append(reset);
    }
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
$('reset-filters').addEventListener('click', resetFilters);
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
