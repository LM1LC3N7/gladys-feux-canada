// -----------------------------------------------------------------------------
// The pure parts: geometry, the strict reading of the features (unknown is
// never 0), the parts of a reading, the states, the triggers, the config.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config.js';
import { DISTANCES } from '../src/constants.js';
import {
  featureUrl,
  featuresOf,
  parseDangerArea,
  parseHotspot,
  parseLegendDate,
  parsePerimeter,
  parseStation,
  strictDate,
  strictNumber,
} from '../src/cwfis.js';
import { buildHouseDevice, houseStates, parseExternalId, stationText } from '../src/devices.js';
import {
  bearingDeg,
  cellBox,
  cellOf,
  compassPoint,
  containsPoint,
  distanceKm,
  distanceToPolygonKm,
} from '../src/geo.js';
import { getText, retryAfterMs } from '../src/http.js';
import { CwfisClient } from '../src/cwfis.js';
import { T } from '../src/i18n.js';
import {
  dangerPart,
  hotspotCount,
  hotspotsPart,
  mapAgeDays,
  perimetersPart,
  stationPart,
} from '../src/model.js';
import { houseEvents, validMemory } from '../src/triggers.js';
import { HOUSES, NOW, fixture } from './helpers/app.js';
import { testClock } from './kit/clock.mjs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';

const home = HOUSES.fredericton;

test('distance, bearing and compass points', () => {
  // Fredericton -> Moncton, about 147 km to the east-north-east.
  const moncton = { latitude: 46.0878, longitude: -64.7782 };
  assert.ok(Math.abs(distanceKm(home, moncton) - 145) < 3);
  assert.equal(compassPoint(bearingDeg(home, moncton), 'en'), 'E');
  assert.equal(compassPoint(270, 'fr'), 'O');
  assert.equal(compassPoint(225, 'fr'), 'SO');
  assert.equal(compassPoint(359, 'en'), 'N');
});

test('the boxes sent are built from the 0.1-degree cell only and hold the whole radius', () => {
  const cell = cellOf(home);
  assert.deepEqual(cell, { west: -66.7, south: 45.9, east: -66.6, north: 46 });
  // Any point of the same cell gives the same boxes: nothing finer than the cell leaves.
  for (const km of [5, 50, 200, 300]) {
    assert.deepEqual(
      cellBox(cellOf({ latitude: 45.901, longitude: -66.699 }), km),
      cellBox(cell, km),
    );
    assert.deepEqual(
      cellBox(cellOf({ latitude: 45.999, longitude: -66.601 }), km),
      cellBox(cell, km),
    );
    const box = cellBox(cell, km);
    for (const v of Object.values(box)) assert.equal(Math.round(v * 10) / 10, v);
    for (const corner of [
      { latitude: 45.9, longitude: -66.7 },
      { latitude: 46, longitude: -66.6 },
    ]) {
      for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const d = km / 111.19;
        const lat = corner.latitude + d * Math.cos((bearing * Math.PI) / 180);
        const lon =
          corner.longitude +
          (d * Math.sin((bearing * Math.PI) / 180)) / Math.cos((lat * Math.PI) / 180);
        assert.ok(lat >= box.south && lat <= box.north, `${km} km ${bearing}`);
        assert.ok(lon >= box.west && lon <= box.east, `${km} km ${bearing}`);
      }
    }
  }
  const polar = cellBox(cellOf({ latitude: 89.5, longitude: 10 }), 100);
  assert.deepEqual([polar.west, polar.east, polar.north], [-180, 180, 90]);
  // Across the date line (the Aleutians): every longitude, never a box cut at 180.
  const aleutian = cellBox(cellOf({ latitude: 51.9, longitude: 179.95 }), 50);
  assert.deepEqual([aleutian.west, aleutian.east], [-180, 180]);
  assert.deepEqual(cellOf({ latitude: 90, longitude: 180 }), {
    west: 179.9,
    south: 89.9,
    east: 180,
    north: 90,
  });
});

test('point in polygon (holes are outside) and distance to an outline', () => {
  const square = (x0, y0, x1, y1) => [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ];
  const donut = {
    type: 'Polygon',
    coordinates: [square(-67, 45, -66, 46), square(-66.8, 45.2, -66.2, 45.8)],
  };
  assert.equal(containsPoint(donut, { latitude: 45.1, longitude: -66.9 }), true);
  assert.equal(containsPoint(donut, { latitude: 45.5, longitude: -66.5 }), false);
  assert.equal(distanceToPolygonKm(donut, { latitude: 45.1, longitude: -66.9 }), 0);
  // In the hole: 0.2 degree of longitude to the inner ring, about 15.6 km.
  const inHole = distanceToPolygonKm(donut, { latitude: 45.5, longitude: -66.5 });
  assert.ok(Math.abs(inHole - 0.3 * 111.19 * Math.cos((45.5 * Math.PI) / 180)) < 0.5, `${inHole}`);
  const multi = { type: 'MultiPolygon', coordinates: [[square(-60, 45, -59, 46)]] };
  assert.ok(distanceToPolygonKm(multi, home) > 400);
  assert.equal(distanceToPolygonKm({ type: 'Point', coordinates: [0, 0] }, home), undefined);
  assert.equal(
    distanceToPolygonKm({ type: 'Polygon', coordinates: [[[0, 'x']]] }, home),
    undefined,
  );
});

test('strict numbers and dates: empty, null, text are unknown, never 0', () => {
  for (const v of ['', ' ', null, undefined, 'abc', '1e3', NaN, Infinity, true, [], {}]) {
    assert.equal(strictNumber(v), undefined, String(v));
  }
  assert.equal(strictNumber('12.5'), 12.5);
  assert.equal(strictNumber(0), 0);
  assert.equal(strictDate('2026-10-29T12:00:00Z'), Date.UTC(2026, 9, 29, 12));
  for (const v of ['', '2026-10-29', '2026-10-29T12:00:00', 'yesterday', 0, null]) {
    assert.equal(strictDate(v), undefined, String(v));
  }
});

test('the captures parse; an unreadable feature is dropped, never zeroed', () => {
  const hotspots = featuresOf(fixture('hotspots-fredericton'), 'h').features.map(parseHotspot);
  assert.equal(hotspots.length, 9);
  assert.ok(hotspots.every((h) => h && Number.isFinite(h.at) && h.satellite));
  assert.equal(
    parseHotspot({ properties: { lat: '', lon: -66, rep_date: '2026-10-29T12:00:00Z' } }),
    undefined,
  );
  assert.equal(
    parseHotspot({ properties: { lat: 45, lon: 200, rep_date: '2026-10-29T12:00:00Z' } }),
    undefined,
  );
  const perimeter = parsePerimeter(featuresOf(fixture('perimeters'), 'p').features[0]);
  assert.equal(perimeter.geometry.type, 'Polygon');
  assert.equal(perimeter.hotspots, 199);
  const stations = featuresOf(fixture('stations'), 's').features.map(parseStation).filter(Boolean);
  assert.ok(stations.length > 50);
  assert.ok(stations.every((s) => s.id.startsWith('aes-') || s.id.startsWith('wmo-')));
  assert.ok(stations.some((s) => s.name === 'FREDERICTON CDA CS'));
  assert.ok(stations.every((s) => !/^\s|\s$|\+/.test(s.name)));
  const noFwi = parseStation({
    properties: { aes: '1', lat: 45, lon: -66, rep_date: '2026-10-29T12:00:00Z', fwi: null },
  });
  assert.equal(noFwi.fwi, undefined);
  assert.equal(
    parseStation({
      properties: { aes: '1', lat: 45, lon: -66, rep_date: '2026-10-29T12:00:00Z', fwi: '' },
    }).fwi,
    undefined,
  );
  const control = parseStation({
    properties: {
      aes: '1',
      name: `A${String.fromCharCode(27)}[0mB`,
      lat: 45,
      lon: -66,
      rep_date: '2026-10-29T12:00:00Z',
    },
  });
  assert.equal(control.name, 'A [0mB');
  const areas = featuresOf(fixture('danger'), 'd').features.map(parseDangerArea);
  assert.ok(areas.every((a) => a && a.code >= 0 && a.code <= 4));
  assert.equal(parseDangerArea({ properties: { GRIDCODE: 5 }, geometry: {} }), undefined);
  assert.equal(parseDangerArea({ properties: { GRIDCODE: '' }, geometry: {} }), undefined);
  assert.equal(parseLegendDate(fixture('danger-legend')), '2026-10-29');
  assert.equal(parseLegendDate({ Legend: [{ title: 'Fire Danger' }] }), undefined);
  assert.throws(() => featuresOf({ features: 'x' }, 'x'), /not a feature collection/);
  assert.throws(() => featuresOf('<xml/>', 'x'), /not a feature collection/);
});

test('the requests ask for GeoJSON in EPSG:4326 with a CQL box in longitude/latitude', () => {
  const url = new URL(
    featureUrl(
      { name: 'public:hotspots_last24hrs', properties: ['lat', 'lon'] },
      { filter: "BBOX(geometry,-68,45,-65.3,46.9,'EPSG:4326')", count: 10 },
    ),
  );
  assert.equal(url.origin, 'https://cwfis.cfs.nrcan.gc.ca');
  assert.equal(url.searchParams.get('srsName'), 'EPSG:4326');
  assert.equal(url.searchParams.get('outputFormat'), 'application/json');
  assert.equal(url.searchParams.get('propertyName'), 'lat,lon');
  assert.equal(url.searchParams.get('count'), '10');
});

test('the hotspots part: count within the radius, nearest, zones capped at the radius', () => {
  const items = featuresOf(fixture('hotspots-fredericton'), 'h').features.map(parseHotspot);
  const part = hotspotsPart(home, items, 100);
  assert.equal(part.count, 9);
  assert.equal(part.nearestKm, 38.5);
  assert.equal(part.zones[30].count, 0);
  assert.equal(part.zones[30].nearest, null);
  assert.equal(part.zones[50].count > 0, true);
  assert.equal(part.zones[300].count, part.count, 'beyond the radius, the radius');
  const small = hotspotsPart(home, items, 20);
  assert.equal(small.count, 0);
  assert.equal(small.nearestKm, null);
  for (const d of DISTANCES) assert.ok(d in part.zones);
});

test('the perimeters part: inside one is 0 km, the others by their outline', () => {
  const items = featuresOf(fixture('perimeters'), 'p').features.map(parsePerimeter);
  const part = perimetersPart(home, items, 100);
  assert.equal(part.count, 1);
  assert.equal(part.nearestKm, 23.8);
  const inside = perimetersPart(
    { latitude: items[0].geometry.coordinates[0][0][1] + 0, longitude: -66.3 },
    [
      {
        ...items[0],
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [-67, 45],
              [-66, 45],
              [-66, 47],
              [-67, 47],
              [-67, 45],
            ],
          ],
        },
      },
    ],
    10,
  );
  assert.equal(inside.inside, true);
  assert.equal(inside.nearestKm, 0);
});

test('the station part: the nearest fresh one with an FWI, else none', () => {
  const stations = featuresOf(fixture('stations'), 's').features.map(parseStation).filter(Boolean);
  const part = stationPart(home, stations, NOW, 200);
  assert.equal(part.status, 'ok');
  assert.equal(part.name, 'FREDERICTON CDA CS');
  assert.equal(part.km, 5.6);
  assert.equal(stationPart(home, stations, NOW + 2 * 86_400_000, 200).status, 'none', 'all stale');
  assert.equal(stationPart(home, [], NOW, 200).status, 'none');
});

test('the danger part: level 1-5, the distance of the nearest area, stale map, none near', () => {
  assert.deepEqual(dangerPart({ code: 2, km: 0 }, { date: '2026-10-29', now: NOW }), {
    status: 'ok',
    level: 3,
    km: 0,
    date: '2026-10-29',
  });
  assert.equal(dangerPart({ code: 2, km: 4 }, { date: '2026-10-27', now: NOW }).km, 4);
  assert.equal(dangerPart({ code: 2, km: 0 }, { date: '2026-10-26', now: NOW }).status, 'stale');
  assert.equal(
    dangerPart({ code: 2, km: 0 }, { date: undefined, now: NOW }).status,
    'ok',
    'no date is never stale',
  );
  assert.equal(dangerPart(undefined, { now: NOW }).status, 'none');
  assert.equal(mapAgeDays('2026-10-29', Date.parse('2026-10-29T23:59:00Z')), 0);
  assert.equal(mapAgeDays('2026-10-28', Date.parse('2026-10-29T00:01:00Z')), 1);
});

test('the device: read only, units of the core, ids from the house selector', () => {
  const gladys = createFakeGladys({ selector: 'feux-canada' });
  const device = buildHouseDevice(gladys, home, 'en');
  assert.equal(device.external_id, 'ext:feux-canada:house:fredericton');
  assert.equal(device.name, 'Wildfires near Fredericton');
  assert.equal(buildHouseDevice(gladys, home, 'fr').name, 'Feux près de Fredericton');
  for (const f of device.features) {
    assert.equal(f.read_only, true);
    assert.ok(f.external_id.startsWith(`${device.external_id}:`));
    assert.notEqual(f.category, 'switch');
  }
  assert.deepEqual(parseExternalId(device.external_id), { selector: 'fredericton' });
  assert.equal(parseExternalId('ext:feux-canada:house:../x'), undefined);
  assert.equal(parseExternalId('ext:feux-canada:other:x'), undefined);
});

test('the states: only the fresh parts; none within the radius is the radius, never 0', () => {
  const id = 'ext:feux-canada:house:fredericton';
  const states = houseStates(
    id,
    {
      hotspots: { status: 'ok', count: 0, nearestKm: null },
      perimeters: { status: 'stale' },
      station: { status: 'none' },
      danger: { status: 'error' },
    },
    50,
  );
  assert.deepEqual(states, [
    { device_feature_external_id: `${id}:hotspots`, state: 0 },
    { device_feature_external_id: `${id}:nearest_hotspot_km`, state: 50 },
  ]);
  assert.equal(
    stationText({ name: 'X', province: 'NB', km: 3.2, at: Date.UTC(2026, 9, 29, 12) }),
    'X (NB), 3.2 km, 2026-10-29 12:00 UTC',
  );
});

test('triggers: nothing without a known value before; re-armed after two empty reads', () => {
  const zones = (n) =>
    Object.fromEntries(
      DISTANCES.map((d) => [
        d,
        {
          count: d >= 50 ? n : 0,
          nearest: n ? { km: 40, bearing: 90, at: NOW, satellite: 'NOAA-21' } : null,
        },
      ]),
    );
  const reading = (n) => ({
    hotspots: { status: 'ok', zones: zones(n) },
    danger: { status: 'error' },
  });
  const ctx = { deviceId: 'd', language: 'fr', now: NOW };
  let r = houseEvents(undefined, reading(3), ctx);
  assert.equal(r.events.length, 0, 'unknown before');
  r = houseEvents(undefined, reading(0), ctx);
  r = houseEvents(r.memory, reading(2), ctx);
  assert.deepEqual(
    r.events.map((e) => e.data.distance),
    ['50', '100', '200', '300'],
  );
  assert.equal(r.events[0].data.direction, 'E');
  r = houseEvents(r.memory, reading(0), ctx);
  r = houseEvents(r.memory, reading(1), ctx);
  assert.equal(r.events.length, 0, 'one empty read does not re-arm');
  r = houseEvents(r.memory, reading(0), ctx);
  r = houseEvents(r.memory, reading(0), ctx);
  r = houseEvents(r.memory, reading(1), ctx);
  assert.equal(r.events.length, 4);
  // A part not read leaves the memory as it was.
  const kept = houseEvents(
    r.memory,
    { hotspots: { status: 'stale' }, danger: { status: 'stale' } },
    ctx,
  );
  assert.deepEqual(kept.memory.zones, r.memory.zones);
});

test('triggers: the danger raised fires each level crossed from 2 up, never a drop', () => {
  const ctx = { deviceId: 'd', language: 'en', now: NOW };
  const at = (level) => ({
    danger: { status: 'ok', level, date: '2026-10-29' },
    station: { status: 'none' },
  });
  let r = houseEvents(undefined, at(1), ctx);
  assert.equal(r.events.length, 0);
  r = houseEvents(r.memory, at(4), ctx);
  assert.deepEqual(
    r.events.map((e) => e.data.level),
    ['2', '3', '4'],
  );
  assert.equal(r.events[0].data.fwi, null);
  r = houseEvents(r.memory, at(2), ctx);
  assert.equal(r.events.length, 0);
  r = houseEvents(r.memory, at(3), ctx);
  assert.deepEqual(
    r.events.map((e) => e.data.level),
    ['3'],
  );
  for (const e of r.events) {
    for (const v of Object.values(e.data)) {
      assert.ok(v === null || ['string', 'number', 'boolean'].includes(typeof v));
      assert.notEqual(v, undefined);
    }
  }
});

test('a memory from /data: too old, from the future or malformed is unknown', () => {
  assert.equal(validMemory({ at: NOW - 49 * 3600_000, zones: {} }, NOW), undefined);
  assert.equal(validMemory({ at: NOW + 1000, zones: {} }, NOW), undefined);
  assert.equal(validMemory('x', NOW), undefined);
  const m = validMemory(
    {
      at: NOW,
      zones: { 50: { active: 'yes', empty: 0 }, 100: { active: true, empty: 9 } },
      danger: 9,
    },
    NOW,
  );
  assert.deepEqual(m.zones, { 100: { active: true, empty: 2 } });
  assert.equal(m.danger, undefined);
});

test('the configuration: bounds, defaults, empty is the default', () => {
  assert.deepEqual(normalizeConfig({}), { radiusKm: 50, pollMinutes: 30, language: 'fr' });
  assert.deepEqual(normalizeConfig({ radius_km: '', poll_minutes: null, language: 'EN' }), {
    radiusKm: 50,
    pollMinutes: 30,
    language: 'en',
  });
  assert.deepEqual(normalizeConfig({ radius_km: 1000, poll_minutes: 1, language: 'de' }), {
    radiusKm: 300,
    pollMinutes: 15,
    language: 'fr',
  });
  assert.equal(normalizeConfig({ radius_km: 'abc' }).radiusKm, 50);
  assert.equal(normalizeConfig(null).radiusKm, 50);
});

test('Retry-After: seconds, or a date against the Date of the answer', () => {
  assert.equal(retryAfterMs('120'), 120_000);
  assert.equal(
    retryAfterMs('Thu, 29 Oct 2026 21:30:00 GMT', 'Thu, 29 Oct 2026 21:20:00 GMT'),
    600_000,
  );
  assert.equal(retryAfterMs('Thu, 29 Oct 2026 21:30:00 GMT', undefined), undefined);
  assert.equal(retryAfterMs('soon'), undefined);
});

test('an answer declaring a length over the budget is refused before reading it', async () => {
  let pulls = 0;
  const fetchImpl = async () =>
    new Response(
      new ReadableStream({
        pull(c) {
          pulls += 1;
          c.enqueue(new Uint8Array(100));
        },
      }),
      { headers: { 'content-length': '999999999' } },
    );
  await assert.rejects(
    getText('https://cwfis.cfs.nrcan.gc.ca/x?a=1', { maxBytes: 1000, fetchImpl }),
    /over 1000 bytes/,
  );
  assert.ok(pulls <= 1, `${pulls} chunks pulled (the stream prefetches one at most)`);
});

test('an error message never carries the query (the box around the house)', async () => {
  const fetchImpl = async () => new Response('x', { status: 500 });
  await assert.rejects(
    getText('https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows?CQL_FILTER=BBOX(-66.7,45.9)', {
      maxBytes: 1000,
      fetchImpl,
    }),
    (err) => err.code === 'server' && !/66|45|CQL/.test(err.message),
  );
});

test('the client sends one request at a time, even asked twice at once', async () => {
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = async () => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return new Response(JSON.stringify(fixture('hotspots-newest')));
  };
  let mono = 0;
  const client = new CwfisClient({
    fetchImpl,
    monotonic: () => (mono += 1000),
    timers: { setTimeout: (fn) => setTimeout(fn, 0), clearTimeout },
  });
  await Promise.all([client.newest('hotspots'), client.newest('hotspots'), client.dangerDate()]);
  assert.equal(peak, 1);
  assert.equal(client.sent, 3);
});

// --- r3 I1: an incomplete answer is a minimum, never "at least 0" nor an empty read ---

test('records missing: the count is a minimum when some hotspot is readable, unknown without (never 0)', () => {
  const id = 'ext:feux-canada:house:fredericton';
  const near = { latitude: home.latitude + 0.2, longitude: home.longitude, at: NOW };
  const far = { latitude: home.latitude + 1.7, longitude: home.longitude, at: NOW };
  const states = (part) =>
    Object.fromEntries(
      houseStates(id, { hotspots: part }, 100).map((s) => [
        s.device_feature_external_id.split(':').pop(),
        s.state,
      ]),
    );
  for (const missing of [{ unreadable: 1 }, { truncated: true }]) {
    const none = hotspotsPart(home, [far], 100, missing);
    assert.equal(none.incomplete, true);
    assert.equal(hotspotCount(none), undefined, 'at least 0 is no count');
    assert.deepEqual(states(none), {}, 'neither 0 nor the radius');
    const some = hotspotsPart(home, [near, far], 100, missing);
    assert.equal(hotspotCount(some), 1, 'one readable within the radius: a true minimum');
    assert.deepEqual(states(some), { hotspots: 1 }, 'the nearest stays unknown');
  }
  // A complete answer with none within the radius is a true 0, the nearest the radius.
  const complete = hotspotsPart(home, [far], 100);
  assert.equal(hotspotCount(complete), 0);
  assert.deepEqual(states(complete), { hotspots: 0, nearest_hotspot_km: 100 });
  assert.equal(hotspotCount({ status: 'stale', count: 3 }), undefined);
  assert.equal(hotspotCount(undefined), undefined);
});

test('records missing: the status says "unknown" or "at least N", never "at least 0"', () => {
  const far = { latitude: home.latitude + 1.7, longitude: home.longitude, at: NOW };
  const near = { latitude: home.latitude + 0.2, longitude: home.longitude, at: NOW };
  const line = (items, missing) =>
    T.house('Home', { hotspots: hotspotsPart(home, items, 100, missing) });
  const unknown = line([far], { unreadable: 1 });
  assert.match(unknown.en, /hotspots unknown \(records missing, none readable within the radius\)/);
  assert.match(unknown.fr, /points chauds inconnus/);
  assert.doesNotMatch(unknown.en, /at least 0|\b0 hotspot/);
  assert.match(line([near, far], { truncated: true }).en, /at least 1 hotspot\(s\)/);
  assert.match(line([near], {}).en, /Home: 1 hotspot\(s\) within the radius/);
});

test('triggers: a read with records missing and none readable is never an empty read', () => {
  const ctx = { deviceId: 'd', language: 'en', now: NOW };
  const fire = { latitude: home.latitude + 0.2, longitude: home.longitude, at: NOW };
  const far = { latitude: home.latitude + 1.7, longitude: home.longitude, at: NOW };
  const read = (items, missing) => ({
    hotspots: hotspotsPart(home, items, 100, missing),
    danger: { status: 'error' },
  });
  const within30 = (r) => r.events.filter((e) => e.data.distance === '30').length;
  let r = houseEvents(undefined, read([]), ctx);
  r = houseEvents(r.memory, read([fire]), ctx);
  assert.equal(within30(r), 1, 'the hotspot 22 km away');
  const active = structuredClone(r.memory.zones);
  // Three reads with an unreadable record and nothing readable within 100 km.
  for (const missing of [{ unreadable: 1 }, { truncated: true }, { unreadable: 2 }]) {
    r = houseEvents(r.memory, read([far], missing), ctx);
    assert.equal(r.events.length, 0);
    assert.deepEqual(r.memory.zones, active, 'the zones stay as they were');
  }
  r = houseEvents(r.memory, read([fire]), ctx);
  assert.equal(within30(r), 0, 'the same hotspot read again: no second alert');
  // A complete empty read, one with records missing, another complete one: re-armed by the
  // two complete ones only (the one in between is left out, as a failed read).
  r = houseEvents(r.memory, read([]), ctx);
  r = houseEvents(r.memory, read([far], { unreadable: 1 }), ctx);
  assert.equal(r.memory.zones[30].active, true);
  assert.equal(r.memory.zones[30].empty, 1);
  r = houseEvents(r.memory, read([]), ctx);
  assert.equal(r.memory.zones[30].active, false);
  // A hotspot readable within the distance counts even when records are missing.
  r = houseEvents(r.memory, read([fire, far], { unreadable: 1 }), ctx);
  assert.equal(within30(r), 1);
  // A zone not active: nothing readable in it keeps it quiet, even with records missing
  // (only the re-arming of an active zone waits for complete reads), so that a hotspot
  // read later still fires: a late first alert, never a second one.
  let q = houseEvents(undefined, read([far], { truncated: true }), ctx);
  assert.deepEqual(q.memory.zones[30], { active: false, empty: 0 });
  q = houseEvents(q.memory, read([far], { unreadable: 1 }), ctx);
  assert.deepEqual(q.memory.zones[30], { active: false, empty: 0 });
  q = houseEvents(q.memory, read([fire, far], { truncated: true }), ctx);
  assert.equal(within30(q), 1);
});

test('the doubt at the border names the Canada-US border, with both distances', () => {
  const doubt = T.house('Calais', {
    perimeters: { status: 'outside', country: 'doubt' },
    danger: { status: 'outside', country: 'doubt' },
  });
  assert.match(
    doubt.en,
    /no perimeter published \(within 1 km of the Canada-US border, or 2 km on a strait: cannot tell\)/,
  );
  assert.match(doubt.fr, /frontière Canada-États-Unis, ou 2 km sur un détroit : impossible à dire/);
  assert.doesNotMatch(doubt.en, /the US border/);
  const outside = T.house('Seattle', { perimeters: { status: 'outside', country: 'usa' } });
  assert.match(outside.en, /no perimeter published \(outside Canada\)/);
});

test('two requests are a full second apart, even when a timer fires early', async () => {
  const clock = testClock();
  const sentAt = [];
  const fetchImpl = async () => {
    sentAt.push(clock.elapsed);
    return new Response(JSON.stringify(fixture('hotspots-newest')));
  };
  // A timer of Node counts from the start of the turn of the event loop: a long
  // one fires a few ms early, a short one on time.
  const timers = {
    setTimeout: (fn, ms) => clock.timers.setTimeout(fn, ms >= 500 ? ms - 20 : ms),
    clearTimeout: clock.timers.clearTimeout,
  };
  const client = new CwfisClient({ fetchImpl, monotonic: clock.monotonic, timers });
  const both = Promise.all([client.newest('hotspots'), client.newest('hotspots')]);
  for (let i = 0; i < 40 && sentAt.length < 2; i += 1) await clock.advance(50);
  await both;
  assert.equal(sentAt.length, 2);
  assert.ok(sentAt[1] - sentAt[0] >= 1000, `${sentAt[1] - sentAt[0]} ms`);
});
