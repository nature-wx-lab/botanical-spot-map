import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCatalog, searchCatalog, safeUrl, currentObservations } from '../site/engine.mjs';
const now = Date.parse('2026-10-08T12:00:00+09:00');
function fixture() {
  const data = JSON.parse(readFileSync(new URL('../site/data/catalog.json', import.meta.url)));
  data.mode = 'manual';
  const url = 'https://example.org/';
  const stamp = '2026-10-08T09:00:00+09:00';
  data.facilities = [{ id: 'test-garden', name: '試験用施設', city: '試験', prefecture: '東京都', categories: ['botanical-garden'], purposes: ['see', 'buy'], public_access: true, official_url: url, verified_at: stamp, location: { lat: 35, lon: 139, source_url: url, verified_at: stamp, precision: 'site-reference' }, sources: [{ url, checked_at: stamp, use_basis: 'independently-verified-facts' }] }];
  data.targets = [{ id: 'outdoor-rose', facility_id: 'test-garden', plant_id: 'rose', area: '試験エリア', environment: 'outdoor', purposes: ['see'] }, { id: 'indoor-agave', facility_id: 'test-garden', plant_id: 'agave', area: '試験温室', environment: 'greenhouse', purposes: ['see'] }];
  data.observations = [{ id: 'rose-observation', target_id: 'outdoor-rose', status: 'peak', inclusion_reason: 'seasonal-peak', observed_at: stamp, published_at: stamp, valid_from: stamp, valid_until: '2026-10-09T09:00:00+09:00', source_url: url, source_type: 'official', reviewed: true, viewable: true, withdrawn: false }];
  return data;
}
test('公開データには架空施設がなく、全21ジャンルを保持する', () => {
  const data = validateCatalog(JSON.parse(readFileSync(new URL('../site/data/catalog.json', import.meta.url))));
  assert.equal(data.categories.length, 21);
  assert.equal(data.facilities.length, 0);
  assert.equal(searchCatalog(data, { peak: true }, now).length, 0);
});
test('植物未選択で見頃検索でき、複数見頃を施設として重複計数しない', () => {
  const data = fixture();
  data.observations.push({ ...data.observations[0], id: 'agave-observation', target_id: 'indoor-agave', status: 'flowering', inclusion_reason: 'notable-flowering' });
  validateCatalog(data);
  assert.equal(searchCatalog(data, { peak: true }, now).length, 1);
  assert.equal(searchCatalog(data, { peak: true, environment: 'indoor' }, now)[0].observations.length, 1);
});
test('別植物・別エリア・販売目的を合成しない', () => {
  const data = validateCatalog(fixture());
  assert.equal(searchCatalog(data, { peak: true, plant: 'agave' }, now).length, 0);
  assert.equal(searchCatalog(data, { peak: true, environment: 'greenhouse' }, now).length, 0);
  assert.equal(searchCatalog(data, { purposes: ['buy'], plant: 'agave' }, now).length, 0);
});
test('情報期限の境界・終了・取消し・非公開・未観測を現在検索から外す', () => {
  for (const patch of [{ valid_until: '2026-10-08T12:00:00+09:00' }, { status: 'starting' }, { status: 'ended' }, { withdrawn: true }, { viewable: false }, { published_at: '2026-10-09T09:00:00+09:00' }]) {
    const data = fixture(); Object.assign(data.observations[0], patch);
    assert.equal(currentObservations(data, now).length, 0);
    assert.equal(searchCatalog(data, {}, now).length, 1);
  }
});
test('見頃情報なしの販売店は通常検索で残る', () => {
  const data = fixture(); data.targets[1].purposes = ['buy']; data.observations = [];
  validateCatalog(data);
  assert.equal(searchCatalog(data, { purposes: ['buy'], plant: 'agave' }, now).length, 1);
  assert.equal(searchCatalog(data, { purposes: ['buy'], plant: 'agave', peak: true }, now).length, 0);
});
test('不正座標・参照・日付・URL・未対応予想で公開を止める', () => {
  for (const change of [d => d.facilities[0].location.lat = 0, d => d.targets[0].plant_id = 'missing', d => d.observations[0].observed_at = 'unknown', d => d.facilities[0].official_url = 'javascript:alert(1)', d => d.forecasts.push({ id: 'not-supported' })]) {
    const data = fixture(); change(data); assert.throws(() => validateCatalog(data));
  }
});
test('リンク先にスクリプト・認証情報・ローカル・HTTPを許可しない', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'http://example.org/', 'https://' + 'a:b@' + 'example.org/', 'https://localhost/', 'https://127.0.0.1/']) assert.equal(safeUrl(url), null);
  assert.equal(safeUrl('https://example.org/'), 'https://example.org/');
});
