import { PURPOSES, ENVIRONMENTS, PREFECTURES, safeUrl, mergeCatalog, searchCatalog, currentObservations, facetCounts, mapLabelPlan, mapClusterPlan, eventStatus } from './engine.mjs';
const $ = id => document.getElementById(id);
const node = (tag, text, className) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; };
const option = (value, text) => { const e = node('option', text); e.value = value; return e; };
const japanBounds = [[23.8, 122.7], [45.7, 146.1]];
let catalog, map, tiles, markers, refreshTimer, mapStopped = false;
let mapMarkers = [], selectedFacilityId = null, rebuildingMarkers = false;
let results = [], listPage = 0, inputTimer;
let mapFrame;
const PAGE_SIZE = 30;
function setupMap() {
  if (!window.L) { $('map-message').textContent = '地図を起動できません。施設一覧からお探しください。'; return; }
  map = L.map('map', { minZoom: 3, maxZoom: 17, scrollWheelZoom: true, fadeAnimation: false, maxBounds: [[17, 115], [49, 160]], maxBoundsViscosity: 0.8 });
  map.fitBounds(japanBounds, { padding: [20, 30] });
  tiles = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', { minZoom: 3, maxZoom: 17, attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a> · VMAP0' }).addTo(map);
  tiles.on('tileerror', () => { if (!mapStopped) $('map-error').hidden = false; });
  tiles.on('load', () => { if (!mapStopped && document.querySelector('.leaflet-tile-loaded')) $('map-error').hidden = true; });
  markers = L.layerGroup().addTo(map);
  map.on('moveend resize', () => { cancelAnimationFrame(mapFrame); mapFrame = requestAnimationFrame(drawMap); });
  new ResizeObserver(() => map.invalidateSize({ pan: false })).observe($('map'));
}
function filters() { return { query: $('query').value.trim(), peak: $('peak').checked, verified: $('verified-only').checked, prefecture: $('prefecture').value, environment: $('environment').value, category: $('category').value, plant: $('plant').value, purposes: [...document.querySelectorAll('[name=purpose]:checked')].map(e => e.value) }; }
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
  if (f.verified) addChip('公式情報を確認した施設', () => { $('verified-only').checked = false; });
  const activeCount = chips.childElementCount;
  chips.hidden = activeCount === 0;
  $('reset-filters').disabled = activeCount === 0;
  $('search-guide').textContent = activeCount ? '選択中の条件を押すと、ひとつずつ解除できます' : '条件なし · 登録済みの全施設が対象です';
  $('conditions').textContent = activeCount ? `${activeCount}条件を適用` : '全施設';
  const extraCount = Number(Boolean(f.plant)) + Number(Boolean(f.environment));
  $('extra-filter-count').textContent = extraCount ? `(${extraCount})` : '';
  $('result-count').textContent = numberLabel(count);
}
function officialLink(url, label) { const e = node('a', label); const href = safeUrl(url); if (href) { e.href = href; e.target = '_blank'; e.rel = 'noopener noreferrer'; } return e; }
const dateLabel = value => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric' }).format(new Date(value));
// Neutral pictograms describe each genre; they are not facility logos.
const iconPaths = {
  'botanical-garden': ['M3 10L12 3L21 10V21H3ZM12 3V21M3 10H21M3 16H21M8 10V21M16 10V21'],
  'flower-park': ['M12 8C7 1 1 7 8 12C1 17 7 23 12 16C17 23 23 17 16 12C23 7 17 1 12 8Z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6'],
  garden: ['M3 16C6 8 18 8 21 16M3 16H21M5 12V17M10 10V16M14 10V16M19 12V17M2 20Q5 18 8 20T14 20T22 20'],
  'cultural-garden': ['M2 5Q12 8 22 5M4 10H20M7 7L6 22M17 7L18 22M3 22H9M15 22H21'],
  urban: ['M3 21V7H9V21M9 21V3H15V21M2 21H22M17 18V12M17 14C14 14 13 10 14 8C18 8 19 12 17 14M17 12C18 8 21 8 22 9C22 12 20 14 17 14'],
  'heritage-tree': ['M9 21L10 14M15 21L14 14M8 21H16M8 15C1 15 1 9 5 7C5 2 12 1 14 5C20 2 24 10 20 13C19 17 15 17 12 15C11 17 8 16 8 15Z'],
  'garden-center': ['M3 9H21L19 3H5ZM4 9V21H20V9M4 14H20M12 21V11M12 17C7 17 7 13 8 12C12 12 14 15 12 17M12 16C12 12 16 11 18 12C18 15 15 17 12 16'],
  'specialist-houseplants': ['M7 17H17L16 22H8ZM12 17V7M12 12C4 13 2 8 5 3C11 2 15 7 12 12ZM12 11C12 4 17 2 21 4C23 9 18 14 12 11M7 5L9 8M17 6L16 9'],
  'specialist-bonsai': ['M5 18H19L17 22H7ZM12 18C6 14 15 13 12 8M4 9C1 5 7 2 10 5C11 1 17 2 17 5C23 3 23 9 19 10C16 12 13 10 11 10C8 12 4 11 4 9Z'],
  nursery: ['M5 3H19V22H5ZM5 7H19M12 18V12M12 14C7 15 7 10 8 9C12 9 14 12 12 14M12 13C13 9 16 8 18 9C18 12 15 14 12 13M9 19H15'],
  florist: ['M5 12L9 22H15L19 12L12 16ZM6 12L10 20M18 12L14 20M12 16V9M7 4L5 6L7 8L9 6ZM17 4L15 6L17 8L19 6ZM12 1L9 4L12 7L15 4ZM7 8L10 15M17 8L14 15'],
  'garden-supplies': ['M2 11H14V14H2ZM3 14L5 22H11L13 14M8 11V5M8 7C3 7 3 3 4 2C8 2 10 5 8 7M18 3H21V10L19.5 13L18 10ZM19.5 13V22'],
  'farm-market': ['M3 10H21L19 22H5ZM2 10H22M6 10L10 4M18 10L14 4M8 14V18M12 14V19M16 14V18M10 4C10 1 14 1 14 4'],
  'aquatic-plants': ['M2 4H22V21H2ZM2 9Q5 7 8 9T14 9T22 9M12 21V12M12 17C6 17 6 12 7 11C11 11 13 15 12 17M12 15C14 11 18 11 19 12C19 16 15 18 12 17M5 18H6M18 6H19'],
  learning: ['M12 6C8 3 4 3 2 4V20C6 19 9 20 12 22C15 20 18 19 22 20V4C19 3 16 3 12 6ZM12 6V22M15 16C13 8 17 6 20 7C21 12 19 16 15 16ZM15 16L19 10'],
  workshop: ['M10 14H20L18 22H12ZM15 14V8M15 10C10 10 10 5 11 4C15 4 17 8 15 10M15 8C15 3 19 2 21 3C22 7 18 10 15 8M3 3H6V10L4.5 13L3 10ZM4.5 13V22'],
  'picking-farm': ['M5 8C0 13 8 22 12 22C16 22 24 13 19 8ZM12 8L8 3L12 4L16 2L15 6L20 7L16 9M12 4V2M8 12H8.1M15 12H15.1M11 16H11.1M16 17H16.1'],
  allotment: ['M2 17L8 14L14 17L20 14L22 15M2 22L8 19L14 22L20 19L22 20M12 13V6M12 8C6 8 5 4 6 2C11 2 14 5 12 8M12 7C14 2 18 2 20 3C20 7 16 10 12 7'],
  'garden-cafe': ['M3 9H17V15A7 7 0 0 1 3 15ZM17 10H20A3 3 0 0 1 20 16H17M2 22H19M10 7C5 7 5 3 6 2C10 2 13 4 10 7ZM10 7L8 4'],
  'nature-trail': ['M3 22C18 15 5 13 14 7M14 8C10 2 16 1 21 2C22 8 17 11 14 8ZM14 8L18 4M4 14C0 9 2 5 7 4C11 9 9 14 4 14ZM4 14L5 8'],
  'plant-event': ['M3 5H21V22H3ZM3 10H21M7 2V7M17 2V7M12 14L9 12L8 15L10 17L10 20L13 19L16 20L16 17L18 15L15 13L12 14Z'],
};
const genreTone = category => ['flower-park', 'florist', 'plant-event'].includes(category) ? 'petal' : category === 'aquatic-plants' ? 'water' : ['garden-supplies', 'nursery', 'farm-market', 'picking-farm', 'garden-cafe'].includes(category) ? 'earth' : 'forest';
function genreIcon(f) {
  const category = f.categories[0];
  const icon = node('span', undefined, `genre-icon tone-${genreTone(category)}`); icon.title = catalog.categories.find(c => c.id === category).name; icon.dataset.genre = category;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  for (const d of iconPaths[category]) { const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
  icon.append(svg); return icon;
}
const eventLabels = { scheduled: '開催予定', active: '開催期間中', ended: '終了', cancelled: '中止' };
function appendEventBadges(root, f) {
  for (const event of catalog.events.filter(e => e.facility_id === f.id)) root.append(node('p', `${eventLabels[eventStatus(event)]} · ${event.name} · ${event.schedule_note}`, `event-badge event-${eventStatus(event)}`));
}
function infoSection(root, heading) { const section = node('section'); section.append(node('h4', heading)); root.append(section); return section; }
function facilityDetails(f) {
  const root = node('div', undefined, 'facility-info');
  if (f.data_tier === 'open-data') {
    infoSection(root, '公開データから収録').append(node('p', `${f.prefecture} ${f.city}の${catalog.categories.find(c => c.id === f.categories[0]).name}として掲載。ジャンル・目的は元の分類と名称による目安です。施設ごとの公式確認は未実施です。`));
    infoSection(root, '訪問前の確認').append(node('p', '営業時間・来訪可否・移転や閉店・扱う植物・在庫・見頃は未確認です。掲載サイトなどで最新情報をご確認ください。位置は入口を保証しません。'));
    const section = infoSection(root, 'データの出典');
    section.append(officialLink('https://docs.overturemaps.org/guides/places/', 'Overture Maps Places'), node('p', `データ版 ${catalog.bulk.release} · 取得 ${dateLabel(catalog.bulk.retrieved_at)}`), node('p', f.source_providers.map(p => `${p.dataset} (${p.license})`).join(' / '), 'info-note'), node('p', `レコードID：${f.source_record_id}`, 'info-note'), officialLink('https://docs.overturemaps.org/attribution/', '出典・ライセンス案内'));
    return root;
  }
  const tags = node('div', undefined, 'facility-genres');
  for (const id of f.categories) tags.append(node('span', catalog.categories.find(c => c.id === id).name));
  root.append(tags);
  for (const event of catalog.events.filter(e => e.facility_id === f.id)) {
    const section = infoSection(root, '期間限定イベント');
    section.append(node('p', `${eventLabels[eventStatus(event)]} · ${event.name} · ${event.schedule_note}`, `event-badge event-${eventStatus(event)}`));
    section.append(node('p', `${event.venue} · ${event.admission_note}`), officialLink(event.source_url, 'イベントの公式案内'), node('p', `${dateLabel(event.checked_at)}確認。開催変更は公式案内をご確認ください。開催期間中の表示は、当日の営業中を示すものではありません。`, 'info-note'));
  }
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
  if (f.summary && f.data_tier !== 'open-data') popup.append(node('p', f.summary, 'facility-summary'));
  popup.append(facilityDetails(f));
  const url = f.official_url || f.listing_url;
  if (url) { const link = officialLink(url, f.data_tier === 'open-data' ? '掲載サイトで情報を確認 ↗' : '公式サイトで最新情報を見る ↗'); link.className = 'facility-official'; popup.append(link); }
  return popup;
}
function updateMapLabels() {
  if (!map || !catalog) return;
  const zoom = map.getZoom(), size = map.getSize();
  const points = mapMarkers.map(item => ({ facility: item.facility, ...map.latLngToContainerPoint(item.marker.getLatLng()) }));
  const visible = new Set(points.map(p => p.facility.id));
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
    label.addEventListener('click', event => { event.stopPropagation(); selectFacility(f); });
    marker.bindTooltip(label, { permanent: true, interactive: true, direction: entry.direction, offset: [entry.direction === 'right' ? (zoom >= 12 ? 22 : 18) : (zoom >= 12 ? -22 : -18), 0], className: 'map-place-tooltip', opacity: 1 });
  }
}
function selectFacility(f) {
  selectedFacilityId = f.id;
  if (!map) return;
  if (window.matchMedia('(max-width:700px)').matches) document.querySelector('.workspace').scrollTop = 0;
  map.setView([f.location.lat, f.location.lon], Math.max(map.getZoom(), 14), { animate: false });
  drawMap();
  mapMarkers.find(item => item.facility.id === f.id)?.marker.openPopup();
}
function drawMap() {
  if (!map || !catalog || rebuildingMarkers) return;
  rebuildingMarkers = true;
  markers.clearLayers(); mapMarkers = [];
  const size = map.getSize(), zoom = map.getZoom();
  const peakIds = new Set(results.filter(r => r.observations.length).map(r => r.facility.id));
  const points = results.map(({ facility }) => ({ facility, ...map.latLngToContainerPoint([facility.location.lat, facility.location.lon]) }));
  const plan = mapClusterPlan(points, zoom, size, selectedFacilityId);
  for (const group of plan) {
    if (group.points.length > 1) {
      const count = group.points.length, html = node('span', numberLabel(count), 'cluster-count');
      const marker = L.marker(map.containerPointToLatLng([group.x, group.y]), { icon: L.divIcon({ html, className: 'plant-cluster', iconSize: [46, 46], iconAnchor: [23, 23] }), title: `${count}施設。クリックで拡大`, alt: `${count}施設の集まり` });
      marker.on('click', () => {
        if (zoom >= 17) {
          const box = node('div', undefined, 'cluster-list'); box.append(node('strong', `近接する ${count}施設`));
          for (const point of group.points) { const button = node('button', point.facility.name); button.type = 'button'; button.addEventListener('click', () => selectFacility(point.facility)); box.append(button); }
          marker.bindPopup(box, { maxHeight: 240, minWidth: 200 }).openPopup();
        } else {
          const bounds = L.latLngBounds(group.points.map(p => [p.facility.location.lat, p.facility.location.lon]));
          map.fitBounds(bounds, { padding: [45, 45], maxZoom: Math.min(17, zoom + 3), animate: false });
          if (map.getZoom() <= zoom) map.setZoom(zoom + 1);
        }
      });
      markers.addLayer(marker); continue;
    }
    const facility = group.points[0].facility, icon = genreIcon(facility);
    if (peakIds.has(facility.id)) icon.classList.add('has-peak');
    const marker = L.marker([facility.location.lat, facility.location.lon], { icon: L.divIcon({ html: icon, className: 'genre-marker', iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -17] }), title: facility.name, alt: facility.name });
    marker.bindPopup(() => facilityPopup(facility), { className: 'botanical-popup', autoPan: false, maxWidth: Math.min(340, size.x - 48), minWidth: 200, maxHeight: Math.max(80, Math.min(360, size.y / 2 - 65)) });
    marker.on('click', () => selectFacility(facility));
    marker.on('popupopen', () => { selectedFacilityId = facility.id; $('map-message').hidden = true; updateMapLabels(); });
    marker.on('popupclose', () => { if (!rebuildingMarkers && selectedFacilityId === facility.id) { selectedFacilityId = null; $('map-message').hidden = false; updateMapLabels(); } });
    markers.addLayer(marker); mapMarkers.push({ marker, facility });
  }
  rebuildingMarkers = false;
  updateMapLabels();
  if (selectedFacilityId) mapMarkers.find(item => item.facility.id === selectedFacilityId)?.marker.openPopup();
  $('map-message').hidden = Boolean(selectedFacilityId && mapMarkers.some(item => item.facility.id === selectedFacilityId));
  $('map-message').textContent = `候補 ${numberLabel(results.length)}件 · 数字を押すと拡大`;
}
function card(result) {
  const { facility: f, observations, targets } = result;
  const e = node('article', undefined, 'spot-card');
  const details = node('details', undefined, 'spot-detail'); details.append(node('summary', '施設情報・見頃・出典を確認'));
  const title = node('button'); title.append(genreIcon(f), node('span', f.name)); title.type = 'button'; title.addEventListener('click', () => selectFacility(f));
  e.append(title, node('p', `${f.prefecture} ${f.city} · ${f.purposes.map(p => PURPOSES[p]).join('・')}`));
  e.append(node('p', catalog.categories.find(c => c.id === f.categories[0]).name, 'spot-genre'));
  if (f.summary && f.data_tier !== 'open-data') e.append(node('p', f.summary, 'spot-summary'));
  appendEventBadges(e, f);
  for (const o of observations) {
    const t = targets.find(t => t.id === o.target_id), p = catalog.plants.find(p => p.id === t.plant_id);
    e.append(node('p', `${p.name} · ${o.status === 'peak' ? '見頃' : '注目の開花'} · ${ENVIRONMENTS[t.environment]}／${t.area}`, 'spot-status'));
    const source = node('p', `${dateLabel(o.observed_at)}の現地情報 · ${o.source_type === 'official' ? '施設公式発表' : '運営者の現地確認'}`);
    source.append(document.createTextNode(' '), officialLink(o.source_url, '開花情報の出典'));
    details.append(source);
  }
  if (!observations.length) e.append(node('p', '現在の見頃は未確認'));
  e.append(node('p', f.data_tier === 'open-data' ? '公開データ · 公式情報は未確認' : '公式情報を確認した施設', 'source-tier'));
  details.addEventListener('toggle', () => { if (!details.open || details.dataset.loaded) return; details.dataset.loaded = 'true'; details.append(facilityDetails(f)); const url = f.official_url || f.listing_url; if (url) details.append(officialLink(url, f.data_tier === 'open-data' ? 'データに掲載されたサイト' : '施設の公式サイト')); });
  e.append(details);
  return e;
}
function renderList() {
  const list = $('result-list'); list.replaceChildren();
  if (!results.length) {
    const empty = node('div', undefined, 'empty');
    empty.append(node('h3', '条件に合う登録情報がありません'), node('p', filters().peak ? '有効な見頃情報が未登録です。見頃ではないという意味ではありません。' : '植物の種類・屋内外が未確認の施設は、その条件では表示されません。条件を減らしてお試しください。'));
    const reset = node('button', 'すべての登録施設に戻す', 'empty-reset'); reset.type = 'button'; reset.addEventListener('click', resetFilters); empty.append(reset); list.append(empty);
  }
  const start = listPage * PAGE_SIZE;
  for (const result of results.slice(start, start + PAGE_SIZE)) list.append(card(result));
  $('page-status').textContent = results.length ? `${numberLabel(start + 1)}–${numberLabel(Math.min(start + PAGE_SIZE, results.length))} / ${numberLabel(results.length)}件` : '0件';
  $('page-prev').disabled = listPage === 0;
  $('page-next').disabled = start + PAGE_SIZE >= results.length;
  $('fit-results').disabled = results.length === 0;
}
function render(resetPage = true) {
  if (!catalog) return;
  const f = filters(), now = Date.now();
  results = searchCatalog(catalog, f, now);
  if (resetPage) listPage = 0;
  listPage = Math.min(listPage, Math.max(0, Math.ceil(results.length / PAGE_SIZE) - 1));
  if (!results.some(r => r.facility.id === selectedFacilityId)) selectedFacilityId = null;
  updateFilterUI(f, results.length, now); renderList(); drawMap();
  $('data-status').textContent = `登録 ${numberLabel(catalog.facilities.length)}件 · 47都道府県 · 公開データ版 ${catalog.bulk.release}`;
}
for (const p of PREFECTURES) $('prefecture').append(option(p, p));
$('search').addEventListener('submit', e => e.preventDefault());
$('query').addEventListener('input', () => { clearTimeout(inputTimer); inputTimer = setTimeout(() => render(), 180); });
$('search').addEventListener('change', () => { clearTimeout(inputTimer); render(); });
for (const [id, delta] of [['page-prev', -1], ['page-next', 1]]) $(id).addEventListener('click', () => { listPage += delta; renderList(); $('result-heading').scrollIntoView({ block: 'start' }); });
$('fit-results').addEventListener('click', () => { if (map && results.length) { selectedFacilityId = null; map.fitBounds(results.map(r => [r.facility.location.lat, r.facility.location.lon]), { padding: [35, 35], maxZoom: 14, animate: false }); drawMap(); } });
$('map-japan').addEventListener('click', () => { selectedFacilityId = null; map?.fitBounds(japanBounds, { padding: [20, 30], animate: false }); drawMap(); });
$('reset-filters').addEventListener('click', resetFilters);
$('show-japan').addEventListener('click', () => { if (map) map.fitBounds(japanBounds, { padding: [20, 30] }); $('about').close(); });
$('map-stop').addEventListener('click', () => { if (!map || !tiles) return; mapStopped = !mapStopped; if (mapStopped) map.removeLayer(tiles); else tiles.addTo(map); $('map-stop').textContent = mapStopped ? '地図通信を再開' : '地図通信を停止'; $('map-stop').setAttribute('aria-pressed', String(mapStopped)); $('map-error').hidden = true; });
$('about-open').addEventListener('click', () => $('about').showModal());
$('about-close').addEventListener('click', () => $('about').close());
setupMap();
try {
  const responses = await Promise.all(['catalog.json', 'nationwide.json'].map(file => fetch(`./data/${file}`, { cache: 'no-cache' })));
  if (responses.some(response => !response.ok)) throw new Error('公開データを取得できません');
  const [manual, bulk] = await Promise.all(responses.map(response => response.json()));
  catalog = mergeCatalog(manual, bulk);
  for (const c of catalog.categories) $('category').append(option(c.id, c.name));
  for (const p of catalog.plants) $('plant').append(option(p.id, p.name));
  const key = $('genre-key');
  for (const category of catalog.categories) { const item = node('li'); item.append(genreIcon({ categories: [category.id] }), node('span', category.name)); key.append(item); }
  if (catalog.facilities.some(f => f.location.source_url?.startsWith('https://www.openstreetmap.org/'))) map?.attributionControl.addAttribution('施設位置の一部 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>');
  render();
  map?.attributionControl.addAttribution('施設データ: <a href="https://docs.overturemaps.org/attribution/" target="_blank" rel="noopener noreferrer">Overture Maps</a>');
  refreshTimer = setInterval(() => render(false), 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(false); });
  window.addEventListener('pageshow', () => render(false));
} catch {
  $('result-list').replaceChildren(node('p', '施設情報を読み込めません。時間をおいて再読み込みしてください。'));
  $('data-status').textContent = '公開データの取得・形式確認に失敗しました';
  if (map) $('map-message').textContent = '施設情報を読み込めません';
}
