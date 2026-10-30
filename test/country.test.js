// -----------------------------------------------------------------------------
// Canada or not (src/canada.js on the bundled Natural Earth outline), and the
// danger class on the REAL map around Canadian cities (captures of
// 2026-10-29, outlines simplified for the fixtures: test/fixtures/danger-*).
// The perimeters and the danger map cover Canada only: a US house gets
// neither, a Canadian city off the polygons gets the nearest area.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countryOf, inCanada } from '../src/canada.js';
import { F, created, createServer, fixture, setup } from './helpers/app.js';

const place = (name, latitude, longitude) => ({
  id: name,
  name,
  selector: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  latitude,
  longitude,
});
const TORONTO = place('Toronto', 43.6532, -79.3832);
const MONTREAL = place('Montreal', 45.5017, -73.5673);
const WHITEHORSE = place('Whitehorse', 60.7212, -135.0568);
const IQALUIT = place('Iqaluit', 63.7467, -68.517);
const CALAIS = place('Calais ME', 45.1887, -67.2785);
const LUBEC = place('Lubec ME', 44.8653, -66.9847);
const SUMAS = place('Sumas WA', 48.9967, -122.2655);

test('the outline is small and from Natural Earth (public domain)', () => {
  const text = readFileSync(new URL('../src/outline.json', import.meta.url), 'utf8');
  assert.ok(text.length < 250 * 1024, `${text.length} bytes`);
  assert.match(JSON.parse(text).source, /^Natural Earth 1:10m Admin 0 Countries/);
});

test('Canadian cities, shores, islands and the North are in Canada', () => {
  for (const [name, lat, lon] of [
    ['Toronto', 43.6532, -79.3832],
    ['Montreal', 45.5017, -73.5673],
    ['Laval', 45.6066, -73.7124],
    ['Kingston', 44.2312, -76.486],
    ['Quebec City', 46.8139, -71.208],
    ['Halifax', 44.6488, -63.5752],
    ['Saint John NB', 45.2733, -66.0633],
    ['Charlottetown', 46.2382, -63.1311],
    ['St Johns NL', 47.5615, -52.7126],
    ['Tofino', 49.153, -125.9066],
    ['Vancouver', 49.2827, -123.1207],
    ['Victoria', 48.4284, -123.3656],
    ['Thunder Bay', 48.3809, -89.2477],
    ['Windsor ON', 42.3149, -83.0364],
    ['Churchill', 58.7684, -94.165],
    ['Whitehorse', 60.7212, -135.0568],
    ['Inuvik', 68.3607, -133.723],
    ['Iqaluit', 63.7467, -68.517],
    ['Abbotsford (0.2 km north of the border)', 49.0021, -122.2655],
  ]) {
    assert.equal(countryOf({ latitude: lat, longitude: lon }), 'canada', name);
  }
});

test('US towns, even next to the border, are never in Canada', () => {
  for (const [name, lat, lon] of [
    ['Calais ME', 45.1887, -67.2785],
    ['Lubec ME', 44.8653, -66.9847],
    ['Eastport ME', 44.9056, -66.9972],
    ['Sumas WA', 48.9967, -122.2655],
    ['Blaine WA', 48.9931, -122.7471],
    ['Sweetgrass MT (30 m south)', 48.9997, -111.9588],
    ['Point Roberts WA', 48.9871, -123.0618],
    ['Detroit', 42.3314, -83.0458],
    ['Buffalo NY', 42.8864, -78.8784],
    ['International Falls MN', 48.6011, -93.4107],
    ['Seattle', 47.6062, -122.3321],
    ['Juneau AK', 58.3019, -134.4197],
    ['Hyder AK', 55.9167, -130.0247],
  ]) {
    assert.equal(inCanada({ latitude: lat, longitude: lon }), false, name);
  }
  // On the 49th parallel the border is exact.
  assert.equal(countryOf({ latitude: 49.0001, longitude: -110 }), 'canada');
  assert.equal(countryOf({ latitude: 48.9999, longitude: -110 }), 'usa');
  // Within 1 km of the border elsewhere: cannot tell (Calais and St Stephen face each other).
  assert.equal(countryOf({ latitude: 45.1887, longitude: -67.2785 }), 'doubt', 'Calais ME');
  assert.equal(countryOf({ latitude: 45.1946, longitude: -67.2756 }), 'doubt', 'St Stephen NB');
  // At sea off Maine, nearer the US shore than the Canadian one: the US.
  assert.equal(countryOf({ latitude: 44.69, longitude: -67.01 }), 'usa');
  // Far from both: elsewhere.
  assert.equal(countryOf({ latitude: 48.85, longitude: 2.35 }), 'elsewhere');
});

test('small islands off the simplified outline are "elsewhere" (said in the docs)', () => {
  for (const [name, lat, lon] of [
    ['Brier Island NS', 44.26, -66.36],
    ['Cape Sable Island NS', 43.45, -65.62],
    ['Sagona Island NL', 47.37, -55.79],
    ['Lucy Islands BC', 54.295, -130.615],
    ['Prince Rupert airport BC (Digby Island)', 54.283, -130.45],
  ]) {
    assert.equal(countryOf({ latitude: lat, longitude: lon }), 'elsewhere', name);
  }
  // The towns of those coasts are in Canada.
  for (const [name, lat, lon] of [
    ['Prince Rupert BC', 54.315, -130.3208],
    ['Twillingate NL', 49.6467, -54.7558],
    ['Yarmouth NS', 43.8375, -66.1174],
    ['Iles-de-la-Madeleine QC', 47.38, -61.85],
  ]) {
    assert.equal(countryOf({ latitude: lat, longitude: lon }), 'canada', name);
  }
});

const cityDanger = (house, name) => {
  const server = createServer();
  server.answer = (route) => (route === 'danger' ? fixture(`danger-${name}`) : undefined);
  return setup({ server, houses: [house], devices: [created(house)] });
};

test('Toronto and Montréal, off the polygons of the real map: the nearest area, its distance said', async () => {
  for (const [house, name, level] of [
    [TORONTO, 'toronto', 3],
    [MONTREAL, 'montreal', 2],
  ]) {
    const t = await cityDanger(house, name);
    await t.start();
    const f = (key) => F(house.selector, key);
    assert.equal(t.last(f('danger')), level, name);
    assert.ok(t.last(f('active_perimeters')) !== undefined, `${name}: perimeters read`);
    assert.match(
      t.gladys.fake.connectionStatus.message.en,
      /nearest area of the map, \d+(\.\d)? km/,
    );
  }
});

test('Whitehorse is in a polygon of the real map; Iqaluit has none near: said, nothing published', async () => {
  const w = await cityDanger(WHITEHORSE, 'whitehorse');
  await w.start();
  assert.equal(w.last(F(WHITEHORSE.selector, 'danger')), 1);
  const i = await cityDanger(IQALUIT, 'iqaluit');
  await i.start();
  assert.equal(i.last(F(IQALUIT.selector, 'danger')), undefined);
  assert.ok(i.last(F(IQALUIT.selector, 'active_perimeters')) !== undefined, 'in Canada');
  assert.match(i.gladys.fake.connectionStatus.message.en, /the far North may be uncovered/);
});

test('Calais, Lubec and Sumas: neither perimeters nor danger, nothing asked for them', async () => {
  for (const house of [CALAIS, LUBEC, SUMAS]) {
    const t = await setup({ houses: [house], devices: [created(house)] });
    await t.start();
    const f = (key) => F(house.selector, key);
    assert.equal(t.last(f('active_perimeters')), undefined, house.name);
    assert.equal(t.last(f('danger')), undefined, house.name);
    assert.equal(t.server.count('perimeters') + t.server.count('danger'), 0, house.name);
    assert.ok(t.last(f('hotspots')) !== undefined, `${house.name}: hotspots cover North America`);
    assert.match(
      t.gladys.fake.connectionStatus.message.en,
      /no perimeter published \((outside Canada|within 1 km of the Canada-US border, or 2 km on a strait: cannot tell)\)/,
    );
  }
});
