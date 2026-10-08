import { PURPOSES, ENVIRONMENTS, PREFECTURES, safeUrl, validateCatalog, searchCatalog, currentObservations, facetCounts, mapLabelPlan, mapMarkerPlan } from './engine.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const option = (value, text) => { const e = node('option', text); e.value = value; return e; };
const japanBounds = [[23.8, 122.7], [45.7, 146.1]];
let catalog, map, tiles, markers, refreshTimer, mapStopped = false;
let mapMarkers = [], selectedFacilityId = null, rebuildingMarkers = false;
function setupMap() {
  if (!window.L) { $('map-message').textContent = '地図を起動できません。施設一覧からお探しください。'; return; }
  map = L.map('map', { minZoom: 3, maxZoom: 17, scrollWheelZoom: true, maxBounds: [[17, 115], [49, 160]], maxBoundsViscosity: 0.8 });
  map.fitBounds(japanBounds, { padding: [20, 30] });
  tiles = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { minZoom: 3, maxZoom: 17, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a> · VMAP0' }).addTo(map);
  tiles.on('tileerror', () => { if (!mapStopped) $('map-error').hidden = false; });
  tiles.on('load', () => { if (!mapStopped && document.querySelector('.leaflet-tile-loaded')) $('map-error').hidden = true; });
  markers = L.layerGroup().addTo(map);
  map.on('zoomend moveend resize', updateMapLabels);
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
const iconPaths = {
  flower: ['M12 8C7 1 1 7 8 12C1 17 7 23 12 16C17 23 23 17 16 12C23 7 17 1 12 8Z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
  leaf: ['M5 19C0 6 10 3 20 4C21 14 15 21 5 19Z', 'M5 19L16 8M10 14L9 9M13 11L18 12'],
  tree: ['M12 2L5 10H8L3 16H10V22H14V16H21L16 10H19Z'],
  shop: ['M4 10V21H20V10M3 4H21L20 10H4ZM9 21V14H15V21M8 4L7 10M16 4L17 10'],
  book: ['M12 6C8 3 4 3 2 4V19C6 18 9 19 12 21C15 19 18 18 22 19V4C19 3 16 3 12 6ZM12 6V21'],
  fruit: ['M12 7C4 2 1 12 7 20C10 23 12 20 12 20C12 20 14 23 17 20C23 12 20 2 12 7ZM12 7V3M12 4C14 1 17 1 19 2C18 5 15 6 12 4'],
  trail: ['M2 20L10 5L16 16L19 11L23 20ZM7 10L10 12L12 9'],
  water: ['M12 2C10 6 4 11 4 16A8 8 0 0 0 20 16C20 11 14 6 12 2ZM8 15C7 18 10 20 12 20'],
  cup: ['M3 8H17V15A7 7 0 0 1 3 15ZM17 9H20A3 3 0 0 1 20 15H17M2 22H19M7 2V5M13 2V5'],
  event: ['M3 5H21V22H3ZM3 10H21M7 2V7M17 2V7M7 14H10M14 14H17M7 18H10'],
};
function genreIcon(f) {
  const category = f.categories[0];
  const kind = category === 'flower-park' || category === 'florist' ? 'flower' : category === 'heritage-tree' || category === 'specialist-bonsai' ? 'tree' : category === 'learning' || category === 'workshop' ? 'book' : category === 'picking-farm' || category === 'allotment' ? 'fruit' : category === 'aquatic-plants' ? 'water' : category === 'garden-cafe' ? 'cup' : category === 'plant-event' ? 'event' : category === 'nature-trail' ? 'trail' : ['garden-center', 'specialist-houseplants', 'nursery', 'garden-supplies', 'farm-market'].includes(category) ? 'shop' : 'leaf';
  const icon = node('span', undefined, 'genre-icon'); icon.title = catalog.categories.find(c => c.id === category).name;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const d of iconPaths[kind]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
  icon.append(svg); return icon;
}
function infoSection(root, heading) { const section = node('section'); section.append(node('h4', heading)); root.append(section); return section; }
function facilityDetails(f) {
  const root = node('div', undefined, 'facility-info');
  const tags = node('div', undefined, 'facility-genres');
  for (const id of f.categories) tags.append(node('span', catalog.categories.find(c => c.id === id).name));
  root.append(tags);
  if (f.features?.length) {
    const section = infoSection(root, 'この施設の特徴'), list = node('ul');
    for (const feature of f.features) list.append(node('li', feature)); section.append(list);
  }
  const seasons = catalog.seasonal_calendars.filter(s => catalog.targets.some(t => t.id === s.target_id && t.facility_id === f.id));
  if (seasons.length) {
    const section = infoSection(root, '見頃の目安（例年）');
    for (const season of seasons) {
      const target = catalog.targets.find(t => t.id === season.target_id), plant = catalog.plants.find(p => p.id === target.plant_id);
      section.append(node('p', `${plant.name} · ${target.area}（${ENVIRONMENTS[target.environment]}）`, 'season-target'));
      const periods = node('dl', undefined, 'season-periods');
      for (const period of season.periods) periods.append(node('dt', period.label), node('dd', period.description));
      section.append(periods, officialLink(season.source_url, '時期の出典'));
    }
    section.append(node('p', '天候などで時期は前後します。訪問日の開花状況は公式サイトでご確認ください。', 'info-note'));
  }
  const bloom = infoSection(root, '現在の見頃');
  const observations = currentObservations(catalog).filter(o => catalog.targets.some(t => t.id === o.target_id && t.facility_id === f.id));
  if (!observations.length) bloom.append(node('p', '有効な現地情報は未登録です。最新の開花案内は公式サイトでご確認ください。'));
  for (const o of observations) {
    const target = catalog.targets.find(t => t.id === o.target_id), plant = catalog.plants.find(p => p.id === target.plant_id);
    bloom.append(node('p', `${plant.name} · ${target.area} · ${o.status === 'peak' ? '見頃' : '注目の開花'}`, 'spot-status'), node('p', `${dateLabel(o.observed_at)}の現地情報 · 有効期限 ${dateLabel(o.valid_until)}`), officialLink(o.source_url, '開花情報の出典'));
  }
  infoSection(root, 'アクセス・利用案内').append(node('p', f.access_note || '営業時間・予約・入場条件は公式サイトでご確認ください。'));
  const sources = node('details', undefined, 'facility-sources'); sources.append(node('summary', '出典・確認日'));
  sources.append(node('p', `施設情報：${dateLabel(f.verified_at)}確認 · 地図の位置：${f.location.precision === 'entrance' ? '入口' : '敷地代表点'}`), officialLink(f.location.source_url, '位置の出典'));
  const sourceList = node('ul');
  for (const source of f.sources) {
    const label = source.url.includes('/businessguide/') ? '公式の営業案内' : source.url.includes('/access/') ? '公式のアクセス案内' : source.url.includes('maruchiba.jp') ? '千葉県公式観光サイト' : '施設の公式情報';
    const item = node('li'); item.append(officialLink(source.url, label), document.createTextNode(` · ${dateLabel(source.checked_at)}確認`)); sourceList.append(item);
  }
  sources.append(sourceList); root.append(sources); return root;
}
function facilityPopup(f) {
  const popup = node('div', undefined, 'facility-popup'), heading = node('div', undefined, 'facility-heading');
  heading.append(genreIcon(f), node('h3', f.name));
  popup.append(heading, node('p', `${f.prefecture} ${f.city}`, 'facility-place'));
  if (f.summary) popup.append(node('p', f.summary, 'facility-summary'));
  popup.append(facilityDetails(f));
  const link = officialLink(f.official_url, '公式サイトで最新情報を見る ↗'); link.className = 'facility-official'; popup.append(link);
  return popup;
}
function updateMapLabels() {
  if (!map || !catalog) return;
  const zoom = map.getZoom(), size = map.getSize();
  const points = mapMarkers.map(item => ({ facility: item.facility, ...map.latLngToContainerPoint(item.marker.getLatLng()) }));
  const visible = new Set(mapMarkerPlan(points, zoom, size, selectedFacilityId));
  const plan = new Map(mapLabelPlan(points.filter(point => visible.has(point.facility.id) && point.facility.id !== selectedFacilityId), zoom, size).map(label => [label.id, label]));
  for (const item of mapMarkers) {
    const { facility: f, marker } = item, entry = plan.get(f.id);
    if (marker.getElement()) marker.getElement().hidden = !visible.has(f.id);
    marker.getElement()?.classList.toggle('genre-marker-wide', zoom < 9);
    const key = !visible.has(f.id) ? 'hidden' : f.id === selectedFacilityId ? 'selected' : entry ? `${entry.tier}/${entry.direction}/${entry.width}` : 'hover';
    if (item.labelKey === key) continue;
    item.labelKey = key;
    marker.unbindTooltip();
    if (key === 'selected' || key === 'hidden') continue;
    if (!entry) { marker.bindTooltip(node('span', f.name)); continue; }
    const label = node('button', undefined, `map-place-label${entry.tier === 2 ? ' has-summary' : ''}`); label.type = 'button'; label.style.width = `${entry.width}px`;
    label.setAttribute('aria-label', `${f.name}の詳細を開く`); label.append(node('strong', f.name));
    if (entry.tier === 2) label.append(node('span', f.summary));
    label.addEventListener('click', event => { event.stopPropagation(); marker.openPopup(); });
    marker.bindTooltip(label, { permanent: true, interactive: true, direction: entry.direction, offset: [entry.direction === 'right' ? (zoom >= 12 ? 22 : 18) : (zoom >= 12 ? -22 : -18), 0], className: 'map-place-tooltip', opacity: 1 });
  }
}
function card(result) {
  const { facility: f, observations, targets } = result;
  const e = node('article', undefined, 'spot-card');
  const details = node('details', undefined, 'spot-detail'); details.append(node('summary', '施設情報・見頃・出典を確認'));
  const title = node('button', f.name); title.type = 'button'; title.addEventListener('click', () => {
    if (!map) return;
    if (window.matchMedia('(max-width:700px)').matches) document.querySelector('.workspace').scrollTop = 0;
    map.setView([f.location.lat, f.location.lon], Math.max(map.getZoom(), 13), { animate: false });
    mapMarkers.find(item => item.facility.id === f.id)?.marker.openPopup();
  });
  e.append(title, node('p', `${f.prefecture} ${f.city} · ${f.purposes.map(p => PURPOSES[p]).join('・')}`));
  if (f.summary) e.append(node('p', f.summary, 'spot-summary'));
  for (const o of observations) {
    const t = targets.find(t => t.id === o.target_id), p = catalog.plants.find(p => p.id === t.plant_id);
    e.append(node('p', `${p.name} · ${o.status === 'peak' ? '見頃' : '注目の開花'} · ${ENVIRONMENTS[t.environment]}／${t.area}`, 'spot-status'));
    const source = node('p', `${dateLabel(o.observed_at)}の現地情報 · ${o.source_type === 'official' ? '施設公式発表' : '運営者の現地確認'}`);
    source.append(document.createTextNode(' '), officialLink(o.source_url, '開花情報の出典'));
    details.append(source);
  }
  if (!observations.length) e.append(node('p', '現在の見頃は未確認'));
  details.append(facilityDetails(f), officialLink(f.official_url, '施設の公式サイト'));
  e.append(details);
  return e;
}
function render() {
  if (!catalog) return;
  const f = filters(), now = Date.now(), results = searchCatalog(catalog, f, now), list = $('result-list');
  const reopenId = selectedFacilityId;
  rebuildingMarkers = true; list.replaceChildren(); markers?.clearLayers(); mapMarkers = []; updateFilterUI(f, results.length, now);
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
      const icon = genreIcon(facility); if (observations.length) icon.classList.add('has-peak');
      const marker = L.marker([facility.location.lat, facility.location.lon], { icon: L.divIcon({ html: icon, className: 'genre-marker', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -17] }), title: facility.name, alt: facility.name });
      marker.bindPopup(facilityPopup(facility), { className: 'botanical-popup', maxWidth: Math.min(340, map.getSize().x - 48), minWidth: 220, maxHeight: Math.max(130, Math.min(400, map.getSize().y - 100)), autoPanPadding: [16, 16] });
      marker.on('popupopen', () => { selectedFacilityId = facility.id; $('map-message').hidden = true; updateMapLabels(); });
      marker.on('popupclose', () => { if (!rebuildingMarkers && selectedFacilityId === facility.id) { selectedFacilityId = null; $('map-message').hidden = false; updateMapLabels(); } });
      markers.addLayer(marker); mapMarkers.push({ marker, facility });
    }
  }
  rebuildingMarkers = false;
  selectedFacilityId = mapMarkers.some(item => item.facility.id === reopenId) ? reopenId : null;
  $('map-message').hidden = Boolean(selectedFacilityId);
  if (selectedFacilityId) mapMarkers.find(item => item.facility.id === selectedFacilityId).marker.openPopup();
  updateMapLabels();
  if (map) { $('map-message').textContent = !catalog.facilities.length ? '初期公開版 · 施設データを準備中' : results.length ? `候補 ${results.length}施設 · 近づくと名前と紹介を表示` : 'この条件の登録情報はありません'; }
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
