// -----------------------------------------------------------------------------
// The guards the r1 review found without a test (each one breaks a rule of
// the module when removed), and the fixes of r1: no idle loop on the Gladys
// API, a frozen /data that holds nothing, unreadable records never counted,
// border houses off the Canadian map, the requests the real server needs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeConfig } from '../src/config.js';
import { MAX_VERTICES, PAUSE, STATE_HEARTBEAT } from '../src/constants.js';
import {
  CwfisClient,
  featuresOf,
  parseHotspot,
  parseStation,
  parseLegendDate,
} from '../src/cwfis.js';
import { houseStates, parseExternalId } from '../src/devices.js';
import { distanceToPolygonKm } from '../src/geo.js';
import { SourceError, getJson } from '../src/http.js';
import { hotspotsPart, perimetersPart, stationPart } from '../src/model.js';
import { createFileStore, createMemoryStore } from '../src/store.js';
import {
  DEVICE,
  F,
  HOUR,
  HOUSES,
  MINUTE,
  NOW,
  SECOND,
  created,
  createServer,
  fixture,
  json,
  setup,
} from './helpers/app.js';

const fred = (key) => F('fredericton', key);
const mk = (sel, lat, lon) => ({
  id: sel,
  name: sel,
  selector: sel,
  latitude: lat,
  longitude: lon,
});
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z/, 'Z');
const square = (lon, lat, d) => ({
  type: 'Polygon',
  coordinates: [
    [
      [lon - d, lat - d],
      [lon + d, lat - d],
      [lon + d, lat + d],
      [lon - d, lat + d],
      [lon - d, lat - d],
    ],
  ],
});

// --- B1: never a loop on the Gladys API --------------------------------------------

const countHouses = (t) => {
  const counter = { calls: 0 };
  const getHouses = t.gladys.getHouses.bind(t.gladys);
  t.gladys.getHouses = (...args) => {
    counter.calls += 1;
    return getHouses(...args);
  };
  return counter;
};

test('no device created (the state after install): the houses once a minute, never a loop', async () => {
  const t = await setup({ devices: [] });
  const counter = countHouses(t);
  await t.start();
  const hostBefore = t.gladys.fake.requests.length;
  await t.wait(HOUR);
  assert.ok(counter.calls <= 62, `${counter.calls} getHouses calls in an hour`);
  assert.ok(t.gladys.fake.requests.length - hostBefore <= 70, 'Gladys API requests bounded');
  assert.equal(t.server.requests.length, 0, 'nothing sent to the CWFIS');
});

test('a device whose house is gone: the houses once a minute, never a loop', async () => {
  const t = await setup({ houses: [] });
  const counter = countHouses(t);
  await t.start();
  await t.wait(HOUR);
  assert.ok(counter.calls <= 62, `${counter.calls} getHouses calls in an hour`);
  assert.equal(t.server.requests.length, 0);
});

test('a read that throws unexpectedly is never retried at once', async () => {
  const t = await setup();
  await t.start();
  const counter = countHouses(t);
  t.app.publishDiscovery = async () => {
    throw new Error('unexpected');
  };
  await t.wait(40 * MINUTE);
  assert.ok(counter.calls >= 1 && counter.calls <= 12, `${counter.calls} calls`);
});

// --- I3, m7: /data frozen, unwritable, unreadable ---------------------------------------

test('a frozen /data (a write that never ends): the reads go on, the status says so, stop returns', async () => {
  const store = createMemoryStore();
  store.save = () => new Promise(() => {});
  const t = await setup({ store });
  await t.start();
  assert.equal(t.last(fred('hotspots')), 9);
  assert.match(t.gladys.fake.connectionStatus.message.en, /\/data does not answer/);
  let done = false;
  const stopping = t.app.stop().then(() => {
    done = true;
  });
  await t.wait(10 * SECOND);
  await stopping;
  assert.ok(done, 'stop returned');
  // A start after it is not held either.
  await t.app.start({ radius_km: 100 });
  await t.wait(10 * SECOND);
  assert.equal(t.app.running, true);
});

test('an unwritable /data is said in the status', async () => {
  const store = createMemoryStore();
  store.failSave = true;
  const t = await setup({ store });
  await t.start();
  assert.match(t.gladys.fake.connectionStatus.message.en, /\/data cannot be written/);
});

test('an unreadable /data at the start is said for the whole session', async () => {
  const store = createMemoryStore();
  store.load = () => ({ data: {}, state: 'unreadable' });
  const t = await setup({ store });
  await t.start();
  assert.equal(t.last(fred('hotspots')), 9, 'the reads go on');
  assert.match(t.gladys.fake.connectionStatus.message.en, /\/data was unreadable/);
  await t.wait(31 * MINUTE);
  assert.match(t.gladys.fake.connectionStatus.message.en, /\/data was unreadable/);
});

// --- I1: the Canadian map, the border ---------------------------------------------

test('inside a polygon of the map is on it; 0.5 km or 3 km outside is not', async () => {
  for (const [offsetKm, covered] of [
    [-1, true],
    [0.5, false],
    [3, false],
  ]) {
    const server = createServer();
    const house = HOUSES.fredericton;
    const north = house.latitude + 0.02 + offsetKm / 111.2;
    const map = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { GRIDCODE: 2 },
          geometry: square(house.longitude, north, 0.02),
        },
      ],
    };
    server.answer = (route) => (route === 'danger' ? map : undefined);
    const t = await setup({ server });
    await t.start();
    assert.equal(server.count('perimeters') === 1, covered, `${offsetKm} km`);
    assert.equal(t.last(fred('active_perimeters')) !== undefined, covered, `${offsetKm} km`);
  }
});

// --- I2, m5, m6: unreadable or cut answers are never counted ---------------------

test('hotspot records unreadable (fields renamed, date without zone): nothing published, said', async () => {
  for (const drift of [
    (p) => {
      p.latitude = p.lat;
      delete p.lat;
    },
    (p) => {
      p.rep_date = p.rep_date.replace('Z', '');
    },
  ]) {
    const server = createServer();
    const hotspots = fixture('hotspots-fredericton');
    for (const f of hotspots.features) drift(f.properties);
    server.answer = (route) => (route === 'hotspots' ? hotspots : undefined);
    const t = await setup({ server });
    await t.start();
    assert.equal(t.last(fred('hotspots')), undefined);
    assert.equal(t.last(fred('nearest_hotspot_km')), undefined);
    assert.match(t.gladys.fake.connectionStatus.message.en, /9 unreadable hotspot record\(s\)/);
  }
});

test('some hotspot records unreadable among good ones: nothing published either', async () => {
  const server = createServer();
  const hotspots = fixture('hotspots-fredericton');
  hotspots.features[0].properties.lat = '';
  server.answer = (route) => (route === 'hotspots' ? hotspots : undefined);
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('hotspots')), undefined);
  assert.match(t.gladys.fake.connectionStatus.message.en, /1 unreadable hotspot/);
});

test('more hotspots than one answer: not published as an exact count', async () => {
  const server = createServer();
  const hotspots = fixture('hotspots-fredericton');
  hotspots.numberMatched = 50_000;
  server.answer = (route) => (route === 'hotspots' ? hotspots : undefined);
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('hotspots')), undefined);
  assert.match(t.gladys.fake.connectionStatus.message.en, /more hotspots than one answer holds/);
});

test('a perimeter without its date, or more perimeters than one answer: not published', async () => {
  for (const change of [
    (p) => delete p.features[0].properties.lastdate,
    (p) => (p.numberMatched = 9999),
  ]) {
    const server = createServer();
    const perimeters = fixture('perimeters');
    change(perimeters);
    server.answer = (route) => (route === 'perimeters' ? perimeters : undefined);
    const t = await setup({ server });
    await t.start();
    assert.equal(t.last(fred('active_perimeters')), undefined);
    assert.match(t.gladys.fake.connectionStatus.message.en, /Perimeters: read failed/);
  }
});

test('a danger polygon of an unknown class is a failed read, not "off the map"', async () => {
  const server = createServer();
  const map = fixture('danger');
  map.features[0].properties.GRIDCODE = 7;
  server.answer = (route) => (route === 'danger' ? map : undefined);
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('danger')), undefined);
  assert.equal(t.last(fred('active_perimeters')), 1, 'the perimeters are still read');
  assert.match(t.gladys.fake.connectionStatus.message.en, /Fire danger: read failed/);
});

test('a station record unreadable fails the station part', async () => {
  const server = createServer();
  const stations = fixture('stations');
  delete stations.features[0].properties.aes;
  delete stations.features[0].properties.wmo;
  server.answer = (route) => (route === 'stations' ? stations : undefined);
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('fwi')), undefined);
  assert.match(
    t.gladys.fake.connectionStatus.message.en,
    /Fire weather station: read failed \(stations: unreadable record/,
  );
});

// --- I4: what the real server needs (shown on the real service by the review) ---

test('the requests: the CRS in every box, the active perimeters only, the newest first', async () => {
  const t = await setup();
  await t.start();
  const query = (route) =>
    new URL(t.server.requests.find((r) => r.route === route).url).searchParams;
  for (const route of ['hotspots', 'perimeters', 'stations', 'danger']) {
    // Without it the server reads the box in its Lambert projection: 0 features.
    assert.match(
      query(route).get('CQL_FILTER'),
      /^BBOX\(\w+,[-\d.]+,[-\d.]+,[-\d.]+,[-\d.]+,'EPSG:4326'\)/,
    );
  }
  assert.match(
    query('perimeters').get('CQL_FILTER'),
    new RegExp(` AND lastdate >= '${iso(NOW - 72 * HOUR)}'$`),
  );
  assert.equal(query('hotspots-newest').get('sortBy'), 'rep_date D');
  assert.equal(query('perimeters-newest').get('sortBy'), 'lastdate D');
  assert.equal(query('hotspots').get('count'), '20000');
  // The danger map is asked for the 0.1-degree cell of the house, never a finer box.
  assert.equal(query('danger').get('CQL_FILTER'), "BBOX(the_geom,-66.7,45.9,-66.6,46,'EPSG:4326')");
});

// --- I4: lifecycle -------------------------------------------------------------------

test('getConfig retried: the delay doubles from 5 s up to 5 minutes', async () => {
  const t = await setup();
  const delays = [];
  const setTimeout = t.app.timers.setTimeout;
  t.app.timers.setTimeout = (fn, ms, ...args) => {
    delays.push(ms);
    return setTimeout(fn, ms, ...args);
  };
  let fails = 9;
  await t.app.connected(async () => {
    if (fails > 0) {
      fails -= 1;
      throw new Error('boom');
    }
    return { radius_km: 100 };
  });
  await t.wait(30 * MINUTE);
  assert.deepEqual(
    delays.filter((d) => d >= 5000 && d <= 300_000 && d % 5000 === 0).slice(0, 9),
    [5000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000],
  );
});

test('starts and stops run one after the other; the last configuration wins', async () => {
  const t = await setup();
  let running = 0;
  let peak = 0;
  const publish = t.gladys.publishDiscoveredDevices.bind(t.gladys);
  t.gladys.publishDiscoveredDevices = async (devices) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setImmediate(resolve));
    running -= 1;
    return publish(devices);
  };
  await Promise.all([
    t.app.start({ radius_km: 20 }),
    t.app.start({ radius_km: 150 }),
    t.app.start({ radius_km: 60 }),
  ]);
  assert.equal(peak, 1);
  assert.equal(t.app.config.radiusKm, 60);
});

test('stop writes /data, and waits (bounded) for the read running', async () => {
  const store = createMemoryStore();
  const a = await setup({ store });
  await a.start();
  const saves = store.saves;
  await a.app.stop();
  assert.ok(store.saves > saves, '/data written at the stop');

  const server = createServer();
  server.answer = (route) => (route === 'hotspots-newest' ? 'hang' : undefined);
  const t = await setup({ server });
  await t.app.start({ radius_km: 100 });
  await t.wait(SECOND);
  let done = false;
  const stopping = t.app.stop().then(() => {
    done = true;
  });
  await t.wait(100);
  assert.equal(done, false, 'the read running is waited for');
  await t.wait(5 * SECOND);
  await stopping;
  assert.equal(done, true, 'bounded');
});

test('a stop during the first requests: nothing more is sent, nothing published', async () => {
  const server = createServer();
  let release;
  server.answer = (route) =>
    route === 'perimeters-newest'
      ? new Promise((resolve) => (release = () => resolve(fixture('perimeters-newest'))))
      : undefined;
  const t = await setup({ server });
  await t.app.start({ radius_km: 100 });
  await t.wait(5 * SECOND);
  const stopping = t.app.stop();
  await t.wait(5 * SECOND);
  await stopping;
  const sent = server.requests.length;
  release();
  await t.wait(30 * SECOND);
  assert.equal(server.requests.length, sent);
  assert.equal(t.gladys.fake.states.length, 0);
});

test('a stop while the states are being published: no more house, no scene event after it', async () => {
  const houses = [HOUSES.fredericton, mk('second', 46.5, -67)];
  const server = createServer();
  let empty = true;
  server.answer = (route) =>
    route === 'hotspots' && empty ? { type: 'FeatureCollection', features: [] } : undefined;
  const t = await setup({ server, houses, devices: houses.map((h) => created(h)) });
  await t.start();
  empty = false;
  let calls = 0;
  let release;
  const publish = t.gladys.publishChangedStates.bind(t.gladys);
  t.gladys.publishChangedStates = async (...args) => {
    calls += 1;
    if (calls === 1) await new Promise((resolve) => (release = resolve));
    return publish(...args);
  };
  await t.wait(31 * MINUTE);
  assert.ok(release, 'the publication of the first house is running');
  const stopping = t.app.stop();
  release();
  await t.wait(5 * SECOND);
  await stopping;
  await t.wait(5 * SECOND);
  assert.equal(calls, 1, 'the second house is not published');
  assert.deepEqual(t.gladys.fake.sceneEvents, [], 'no event after the stop');
});

test('a read asked twice at once runs once', async () => {
  const t = await setup();
  await t.app.start({ radius_km: 100 });
  const both = Promise.all([t.app.tick(), t.app.tick()]);
  await t.wait(60 * SECOND);
  await both;
  assert.equal(t.server.count('hotspots-newest'), 1);
});

test('the states are published with the heartbeat (a calm value stays dated)', async () => {
  const t = await setup();
  const options = [];
  const publish = t.gladys.publishChangedStates.bind(t.gladys);
  t.gladys.publishChangedStates = (states, opts) => {
    options.push(opts);
    return publish(states, opts);
  };
  await t.start();
  assert.deepEqual(options, [{ heartbeat: STATE_HEARTBEAT }]);
  assert.equal(STATE_HEARTBEAT, 3 * HOUR);
});

test('a new radius forgets the zones of the triggers: no event for a widened radius', async () => {
  const server = createServer();
  const base = fixture('hotspots-fredericton');
  const far = structuredClone(base.features[0]);
  // About 55 km north of the house.
  far.properties.lat = HOUSES.fredericton.latitude + 0.5;
  far.properties.lon = HOUSES.fredericton.longitude;
  far.properties.rep_date = iso(NOW - 2 * HOUR);
  server.answer = (route) =>
    route === 'hotspots'
      ? { type: 'FeatureCollection', features: [far], numberMatched: 1 }
      : undefined;
  const t = await setup({ server, config: { radius_km: 50 } });
  await t.app.start({ radius_km: 50 });
  await t.wait(30 * SECOND);
  await t.app.start({ radius_km: 100 });
  await t.wait(31 * MINUTE);
  await t.wait(31 * MINUTE);
  assert.deepEqual(t.gladys.fake.sceneEvents, []);
});

test('a deleted device forgets its memory (in /data too)', async () => {
  const store = createMemoryStore();
  const t = await setup({ store });
  await t.start();
  const id = DEVICE('fredericton');
  assert.ok(t.app.memories.has(id));
  await t.app.deviceDeleted({ external_id: id });
  assert.equal(t.app.memories.has(id), false);
  assert.equal(store.data.memories[id], undefined);
});

// --- I4: pauses and /data dates -------------------------------------------------------

test('the pause: 60 s doubled at each 429, Retry-After when longer, never over 6 h', async () => {
  const t = await setup();
  await t.app.start({ radius_km: 100 });
  const lengths = [];
  for (let i = 0; i < 10; i += 1) {
    await t.app.failed(new SourceError('rate_limited', 'x', { status: 429 }));
    lengths.push(Math.round((t.app.pause.until - t.app.now()) / 1000));
  }
  assert.deepEqual(lengths, [60, 120, 240, 480, 960, 1920, 3840, 7680, 15_360, 21_600]);
  t.app.pause = undefined;
  await t.app.failed(new SourceError('server', 'x', { status: 503, retryAfter: 600_000 }));
  assert.equal(Math.round((t.app.pause.until - t.app.now()) / 1000), 600);
  t.app.pause = undefined;
  await t.app.failed(new SourceError('server', 'x', { status: 503, retryAfter: 99_999_999_000 }));
  assert.equal(t.app.pause.until - t.app.now() <= PAUSE.max + 1, true);
});

test('a pause from /data over 6 h, or an attempt dated in the future, is brought back', async () => {
  const paused = await setup({
    store: createMemoryStore({
      pause: { until: NOW + 9e12, count: 1, status: 429 },
      lastAttemptAt: NOW - 3 * HOUR,
    }),
  });
  await paused.start();
  await paused.wait(6 * HOUR + MINUTE);
  assert.ok(paused.server.requests.length > 0, 'read again after 6 h');
  const future = await setup({ store: createMemoryStore({ lastAttemptAt: NOW + 10 * 24 * HOUR }) });
  await future.start();
  await future.wait(31 * MINUTE);
  assert.ok(future.server.requests.length > 0, 'a future date is now');
});

test('a 429 on the date of the danger map is a pause: nothing more is sent', async () => {
  const store = createMemoryStore();
  const server = createServer();
  server.answer = (route) => (route === 'legend' ? new Response('', { status: 429 }) : undefined);
  const t = await setup({ store, server });
  await t.start();
  assert.deepEqual(
    server.requests.map((r) => r.route),
    ['hotspots-newest', 'perimeters-newest', 'legend'],
  );
  assert.equal(store.data.pause.count, 1);
});

test('stale perimeters (no update for 8 days): not published', async () => {
  const server = createServer();
  server.answer = (route) =>
    route === 'perimeters-newest'
      ? {
          type: 'FeatureCollection',
          features: [{ type: 'Feature', properties: { lastdate: iso(NOW - 8 * 24 * HOUR) } }],
        }
      : undefined;
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('active_perimeters')), undefined);
  assert.equal(server.count('perimeters'), 0);
  assert.match(t.gladys.fake.connectionStatus.message.en, /Perimeters: not updated since/);
});

// --- I4: houses -----------------------------------------------------------------------

test('5 houses at most, in Discovery and in the reads; invalid houses are left out', async () => {
  const houses = Array.from({ length: 6 }, (_, i) => mk(`maison-${i}`, 45 + i * 0.5, -66));
  const t = await setup({ houses, devices: houses.map((h) => created(h)) });
  await t.start();
  assert.equal(t.gladys.fake.discoveredDevices.length, 5);
  assert.equal(t.app.outcome.results.length, 5);
  assert.match(t.gladys.fake.connectionStatus.message.en, /Only the first 5 houses/);
  const bad = await setup({
    devices: [],
    houses: [
      mk('ok-1', 45, -66),
      mk('far', 95, -66),
      mk('west', 45, -200),
      mk('Bad Sel!', 45, -66),
    ],
  });
  await bad.start();
  assert.deepEqual(
    bad.gladys.fake.discoveredDevices.map((d) => d.external_id.split(':').pop()),
    ['ok-1'],
  );
});

test('the danger map is read again when the house moves or the map has a new date', async () => {
  const server = createServer();
  let day = '2026-10-29';
  server.answer = (route) =>
    route === 'legend' ? { Legend: [{ title: `Fire Danger - ${day}` }] } : undefined;
  const t = await setup({ server });
  await t.start();
  assert.equal(server.count('danger'), 1);
  day = '2026-10-30';
  await t.wait(31 * MINUTE);
  assert.equal(server.count('danger'), 2, 'a new map date');
  t.gladys.fake.houses[0] = { ...HOUSES.fredericton, latitude: 46.5, longitude: -66.0 };
  await t.wait(31 * MINUTE);
  assert.equal(server.count('danger'), 3, 'the house moved');
});

test('the status after a house is gone no longer shows its last values; long names are cut', async () => {
  const long = { ...mk('long', 45.5, -66.3), name: 'A'.repeat(120) };
  const t = await setup({
    houses: [HOUSES.fredericton, long],
    devices: [created(), created(long)],
  });
  await t.start();
  const message = t.gladys.fake.connectionStatus.message.en;
  assert.doesNotMatch(message, /A{41}/);
  assert.match(message, /not confirmed fires/);
  t.gladys.fake.houses.splice(0, 1);
  // A scan sees the house gone: the status drops its last values at once.
  await t.app.scan();
  assert.doesNotMatch(t.gladys.fake.connectionStatus.message.en, /Feux près de Fredericton:/);
  assert.match(
    t.gladys.fake.connectionStatus.message.en,
    /no longer exists or is no longer located/,
  );
});

test('the test button gives the reasons a part is not published', async () => {
  const server = createServer();
  const old = fixture('hotspots-newest');
  old.features[0].properties.rep_date = '2026-10-28T01:00:00Z';
  server.answer = (route) => (route === 'hotspots-newest' ? old : undefined);
  const t = await setup({ server });
  await t.start();
  const answer = await t.app.testConnection();
  assert.match(answer.en, /stale: not published/);
  assert.match(answer.en, /Next read at/);
});

// --- I4: pure guards ------------------------------------------------------------------

test('records out of range, without date, negative FWI, station without id: unreadable', () => {
  assert.equal(
    parseHotspot({ id: 'x', properties: { lat: 95, lon: -66, rep_date: iso(NOW) } }),
    undefined,
  );
  assert.equal(
    parseHotspot({ id: 'x', properties: { lat: 45, lon: -66, sensor: 'v' } }),
    undefined,
  );
  assert.equal(
    parseStation({ properties: { aes: '1', lat: 45, lon: -66, rep_date: iso(NOW), fwi: -1 } }).fwi,
    undefined,
  );
  assert.equal(
    parseStation({ properties: { lat: 45, lon: -66, rep_date: iso(NOW), fwi: 3 } }),
    undefined,
  );
  assert.throws(() => featuresOf({ features: [] }, 'x'), /not a feature collection/);
  assert.equal(parseLegendDate({ Legend: [{ title: 'x - 2026-13-45' }] }), undefined);
});

test('the client flags cut answers and refuses too many vertices', async () => {
  const client = new CwfisClient({
    fetchImpl: async () => json({ type: 'FeatureCollection', numberMatched: 9999, features: [] }),
    timers: { setTimeout: (fn) => setTimeout(fn, 0), clearTimeout },
  });
  const box = { west: 0, south: 0, east: 1, north: 1 };
  assert.equal((await client.hotspots(box)).truncated, true);
  assert.equal((await client.perimeters(box, 0)).truncated, true);
  // One polygon with more vertices than allowed (each a valid position).
  const ring = Array.from({ length: MAX_VERTICES + 2 }, (_, i) => [i % 2 ? -66 : -66.001, 45]);
  ring.push(ring[0]);
  const big = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { lastdate: iso(NOW), GRIDCODE: 1 },
        geometry: { type: 'Polygon', coordinates: [ring] },
      },
    ],
  };
  const heavy = new CwfisClient({
    fetchImpl: async () => json(big),
    timers: { setTimeout: (fn) => setTimeout(fn, 0), clearTimeout },
  });
  await assert.rejects(heavy.perimeters(box, 0), /too many vertices/);
  await assert.rejects(heavy.dangerAreas(box), /too many vertices/);
});

test('an XML exception report is told apart from a page that is not JSON', async () => {
  const xml = async () => new Response('<?xml?><ows:ExceptionReport/>');
  const html = async () => new Response('<html>');
  const url = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows';
  await assert.rejects(getJson(url, { maxBytes: 1000, fetchImpl: xml }), /refused the request/);
  await assert.rejects(getJson(url, { maxBytes: 1000, fetchImpl: html }), /not JSON/);
});

test('model guards: future or far stations, perimeters beyond the radius, the nearest first', () => {
  const home = { latitude: 45, longitude: -66 };
  const station = { id: 'a', name: 'a', latitude: 45.1, longitude: -66, fwi: 5 };
  assert.equal(stationPart(home, [{ ...station, at: NOW + 5 * HOUR }], NOW, 200).status, 'none');
  assert.equal(
    stationPart(home, [{ ...station, latitude: 47.2, at: NOW - HOUR }], NOW, 200).status,
    'none',
  );
  assert.equal(
    perimetersPart(home, [{ geometry: square(-66, 46.5, 0.05), lastAt: NOW }], 50).count,
    0,
  );
  const near = hotspotsPart(
    home,
    [
      { latitude: 45.4, longitude: -66, at: NOW },
      { latitude: 45.1, longitude: -66, at: NOW },
    ],
    100,
  );
  assert.equal(near.nearestKm, 11.1);
});

test('no active perimeter within the radius: the distance is the radius, never 0', () => {
  const states = houseStates(
    'ext:x:house:a',
    { perimeters: { status: 'ok', count: 0, nearestKm: null } },
    50,
  );
  assert.deepEqual(
    states.map((s) => s.state),
    [0, 50],
  );
});

test('another module id, a boolean in the form, a polygon across the date line', () => {
  assert.equal(parseExternalId('foo:house:abc'), undefined);
  assert.equal(normalizeConfig({ radius_km: true }).radiusKm, 50);
  // A polygon east of 180 (179.0 to 179.9 E), the house at 179.5 W: ~ 40 km across the date line.
  const km = distanceToPolygonKm(
    {
      type: 'Polygon',
      coordinates: [
        [
          [179, 50],
          [179.9, 50],
          [179.9, 51],
          [179, 51],
          [179, 50],
        ],
      ],
    },
    { latitude: 50.5, longitude: -179.5 },
  );
  assert.ok(km > 30 && km < 60, `${km}`);
});

// --- I4: /data on a real file system --------------------------------------------------

test('/data: a file over 256 KB is not ours; a failed write leaves the old file whole', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'feux-canada-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const big = join(dir, 'big.json');
  await writeFile(big, JSON.stringify({ pad: 'x'.repeat(300 * 1024) }));
  assert.equal(createFileStore(big).load().state, 'unreadable');
  const file = join(dir, 'state.json');
  await writeFile(file, '{"a":1}');
  // The temporary file cannot be written (a directory is in its way).
  await mkdir(`${file}.tmp`);
  await assert.rejects(createFileStore(file).save({ b: 2 }));
  assert.equal(await readFile(file, 'utf8'), '{"a":1}');
});
