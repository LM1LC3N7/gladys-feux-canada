// -----------------------------------------------------------------------------
// The app on the fake Gladys, a fake CWFIS answering the real captures, and a
// virtual clock: what is read, when, what is published, what is said.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { USER_AGENT } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
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
const READ = [
  'hotspots-newest',
  'perimeters-newest',
  'legend',
  'hotspots',
  'danger',
  'perimeters',
  'stations',
];

test('a house with its device: one read of every layer, one request at a time, honest User-Agent', async () => {
  const t = await setup();
  await t.start();
  assert.deepEqual(
    t.server.requests.map((r) => r.route),
    READ,
  );
  assert.equal(t.server.peak, 1, 'never two requests at once');
  for (const r of t.server.requests) {
    assert.equal(r.headers['User-Agent'], USER_AGENT);
    assert.doesNotMatch(r.headers['User-Agent'], /Mozilla|Chrome|Safari/);
    assert.equal(r.headers.Accept, 'application/json');
    // The house is never sent: only boxes snapped to a tenth of a degree.
    assert.doesNotMatch(r.url, /45\.963|66\.643/);
  }
  assert.equal(t.last(fred('hotspots')), 9);
  assert.equal(t.last(fred('nearest_hotspot_km')), 38.5);
  assert.equal(t.last(fred('active_perimeters')), 1);
  assert.equal(t.last(fred('nearest_perimeter_km')), 23.8);
  assert.equal(t.last(fred('fwi')), 11);
  assert.equal(t.last(fred('danger')), 3);
  assert.match(
    t.last(fred('station')),
    /^FREDERICTON CDA CS \(NB\), 5\.6 km, 2026-10-29 12:00 UTC$/,
  );
  const status = t.gladys.fake.connectionStatus;
  assert.equal(status.connected, true);
  assert.match(
    status.message.en,
    /9 hotspot\(s\) within the radius, 1 active perimeter\(s\), FWI 11/,
  );
  assert.match(status.message.en, /not confirmed fires/);
  assert.match(status.message.fr, /pas des feux confirmés/);
  assert.deepEqual(t.gladys.fake.sceneEvents, [], 'nothing fires on the first reading');
});

test('requests are spaced by a second at least', async () => {
  const t = await setup();
  const at = [];
  const fetch = t.server.fetch;
  t.server.fetch = (...args) => {
    at.push(t.clock.elapsed);
    return fetch(...args);
  };
  t.app.client.fetchImpl = t.server.fetch;
  await t.start();
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i] - at[i - 1] >= 999, `gap ${at[i] - at[i - 1]}`);
  }
});

test('Discovery offers the located houses only; without a device nothing is read', async () => {
  const t = await setup({ devices: [], houses: [HOUSES.fredericton, HOUSES.nowhere] });
  await t.start();
  assert.deepEqual(
    t.gladys.fake.discoveredDevices.map((d) => d.external_id),
    [DEVICE('fredericton')],
  );
  assert.equal(t.server.requests.length, 0);
  assert.match(t.gladys.fake.connectionStatus.message.en, /create the device/);
  await t.app.scan();
  await t.wait(HOUR);
  assert.equal(t.server.requests.length, 0, 'a scan never reads the source');
});

test('the next read comes at the interval, never sooner; a created device waits for it', async () => {
  const t = await setup({ config: { radius_km: 100, poll_minutes: 30 } });
  await t.start();
  assert.equal(t.server.count('hotspots'), 1);
  await t.app.deviceChanged();
  await t.app.scan();
  await t.wait(29 * MINUTE);
  assert.equal(t.server.count('hotspots'), 1, 'nothing before the interval');
  assert.equal(t.server.count('hotspots-newest'), 1);
  await t.wait(2 * MINUTE);
  assert.equal(t.server.count('hotspots'), 2);
  assert.equal(t.server.count('danger'), 1, 'the daily map is not read again within 6 h');
});

test('a wall clock set forward or back never hurries nor stops the reads', async () => {
  const wall = { ms: 0 };
  const t = await setup({ wallOffset: wall });
  await t.start();
  wall.ms = 5 * HOUR;
  await t.wait(10 * MINUTE);
  assert.equal(t.server.count('hotspots-newest'), 1);
  wall.ms = -5 * HOUR;
  await t.wait(25 * MINUTE);
  assert.equal(t.server.count('hotspots-newest'), 2);
});

test('a restart within the interval does not read again sooner (the time is in /data first)', async () => {
  const store = createMemoryStore();
  const a = await setup({ store });
  await a.start();
  assert.ok(Number.isFinite(store.data.lastAttemptAt));
  await a.app.stop();
  const b = await setup({ store, now: NOW + 10 * MINUTE });
  await b.start();
  assert.equal(b.server.requests.length, 0);
  assert.match(b.gladys.fake.connectionStatus.message.en, /Next read at/);
  await b.wait(20 * MINUTE);
  assert.ok(b.server.requests.length > 0);
});

test('the attempt time is saved before the first request goes', async () => {
  const store = createMemoryStore();
  const server = createServer();
  let savedFirst;
  server.answer = () => {
    savedFirst ??= store.data.lastAttemptAt;
    return undefined;
  };
  const t = await setup({ store, server });
  await t.start();
  assert.ok(Number.isFinite(savedFirst));
});

test('a stale hotspot layer: hotspots not published (never 0), said in the status', async () => {
  const server = createServer();
  const old = fixture('hotspots-newest');
  old.features[0].properties.rep_date = '2026-10-28T01:00:00Z';
  server.answer = (route) => (route === 'hotspots-newest' ? old : undefined);
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('hotspots')), undefined);
  assert.equal(t.last(fred('nearest_hotspot_km')), undefined);
  assert.equal(server.count('hotspots'), 0, 'no read of a stale layer');
  assert.equal(t.last(fred('danger')), 3, 'the other parts go on');
  assert.match(t.gladys.fake.connectionStatus.message.en, /stale: not published/);
});

test('an empty hotspot layer is a silent source, not "no fire"', async () => {
  const server = createServer();
  server.answer = (route) =>
    route === 'hotspots-newest' ? { type: 'FeatureCollection', features: [] } : undefined;
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('hotspots')), undefined);
  assert.match(t.gladys.fake.connectionStatus.message.en, /source silent/);
});

test('no hotspot within the radius: count 0 and the distance is the radius, never 0', async () => {
  const server = createServer();
  server.answer = (route) =>
    route === 'hotspots' ? { type: 'FeatureCollection', features: [] } : undefined;
  const t = await setup({ server, config: { radius_km: 40 } });
  await t.start();
  assert.equal(t.last(fred('hotspots')), 0);
  assert.equal(t.last(fred('nearest_hotspot_km')), 40);
});

test('a station without FWI: FWI not published, never as 0', async () => {
  const server = createServer();
  const stations = fixture('stations');
  for (const f of stations.features) f.properties.fwi = null;
  server.answer = (route) => (route === 'stations' ? stations : undefined);
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('fwi')), undefined);
  assert.equal(t.last(fred('station')), undefined);
  assert.match(t.gladys.fake.connectionStatus.message.en, /no FWI/);
});

test('a house outside Canada: no perimeter, no danger published, hotspots are', async () => {
  const t = await setup({ devices: [created(HOUSES.portland)], houses: [HOUSES.portland] });
  await t.start();
  const p = (key) => F('portland', key);
  assert.ok(t.last(p('hotspots')) > 0);
  assert.equal(t.last(p('active_perimeters')), undefined);
  assert.equal(t.last(p('danger')), undefined);
  assert.equal(t.server.count('perimeters'), 0);
  assert.match(t.gladys.fake.connectionStatus.message.en, /no perimeter outside Canada/);
});

test('the date of the danger map unreadable: the values are still read (secondary)', async () => {
  const server = createServer();
  server.answer = (route) =>
    route === 'legend' ? new Response('boom', { status: 404 }) : undefined;
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('danger')), 3);
  assert.equal(t.last(fred('hotspots')), 9);
});

test('a danger map dated 3 days ago is stale: not published', async () => {
  const server = createServer();
  const legend = fixture('danger-legend');
  legend.Legend[0].title = legend.Legend[0].title.replace(/\d{4}-\d{2}-\d{2}$/, '2026-10-26');
  server.answer = (route) => (route === 'legend' ? legend : undefined);
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('danger')), undefined);
  assert.match(t.gladys.fake.connectionStatus.message.en, /dated 2026-10-26, stale/);
});

test('one part failing (HTTP 400) never blocks the others', async () => {
  const server = createServer();
  server.answer = (route) =>
    route === 'stations' ? new Response('bad', { status: 400 }) : undefined;
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('fwi')), undefined);
  assert.equal(t.last(fred('hotspots')), 9);
  assert.equal(t.last(fred('danger')), 3);
  assert.match(
    t.gladys.fake.connectionStatus.message.en,
    /Fire weather station: read failed \(.*HTTP 400\)/,
  );
});

test('an XML exception report (status 200) is a failed part, not a crash', async () => {
  const server = createServer();
  server.answer = (route) =>
    route === 'perimeters'
      ? new Response('<?xml version="1.0"?><ows:ExceptionReport/>', { status: 200 })
      : undefined;
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('active_perimeters')), undefined);
  assert.equal(t.last(fred('hotspots')), 9);
  assert.match(t.gladys.fake.connectionStatus.message.en, /Perimeters: read failed/);
});

test('429: a pause kept in /data, doubled, no request during it, Retry-After when longer', async () => {
  const store = createMemoryStore();
  const server = createServer();
  let limited = true;
  server.answer = (route) =>
    limited && route === 'hotspots'
      ? new Response('slow down', { status: 429, headers: { 'retry-after': '600' } })
      : undefined;
  const t = await setup({ store, server });
  await t.start();
  assert.equal(store.data.pause.count, 1);
  assert.equal(t.gladys.fake.connectionStatus.connected, false);
  assert.match(t.gladys.fake.connectionStatus.message.en, /asked to wait \(HTTP 429\)/);
  const sent = server.requests.length;
  // The interval (30 min) is longer than the pause (10 min): the next read at the interval.
  await t.wait(29 * MINUTE);
  assert.equal(server.requests.length, sent);
  await t.wait(2 * MINUTE);
  assert.ok(server.requests.length > sent);
  assert.equal(store.data.pause.count, 2, 'doubled');
  limited = false;
  await t.wait(31 * MINUTE);
  assert.equal(store.data.pause, undefined, 'a read without 429 ends it');
  assert.equal(t.last(fred('hotspots')), 9);
});

test('a pause longer than the interval holds the reads, also across a restart', async () => {
  const store = createMemoryStore();
  const server = createServer();
  server.answer = (route) =>
    route === 'hotspots-newest'
      ? new Response('no', { status: 503, headers: { 'retry-after': '7200' } })
      : undefined;
  const a = await setup({ store, server });
  await a.start();
  await a.app.stop();
  assert.ok(store.data.pause.until > NOW + HOUR);
  const b = await setup({ store, now: NOW + 40 * MINUTE });
  await b.start();
  assert.equal(b.server.requests.length, 0, 'still paused after the restart');
  await b.wait(HOUR + 25 * MINUTE);
  assert.ok(b.server.requests.length > 0);
});

test('a server that never answers: the request is cut, nothing published, the status says so', async () => {
  const server = createServer();
  server.answer = (route) => (route === 'hotspots-newest' ? 'hang' : undefined);
  const t = await setup({ server });
  await t.start();
  assert.equal(t.gladys.fake.states.length, 0);
  assert.equal(t.gladys.fake.connectionStatus.connected, false);
  assert.match(t.gladys.fake.connectionStatus.message.en, /unreachable \(.*timeout\)/);
});

test('an answer over its byte budget is cut while it streams, never read whole', async () => {
  const server = createServer();
  let pulled = 0;
  server.answer = (route) => {
    if (route !== 'stations') return undefined;
    const chunk = new Uint8Array(64 * 1024).fill(0x20);
    const body = new ReadableStream({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close();
        else controller.enqueue(chunk);
      },
    });
    return new Response(body, { status: 200 });
  };
  const t = await setup({ server });
  await t.start();
  assert.ok(pulled < 100, `${pulled} chunks pulled`);
  assert.equal(t.last(fred('fwi')), undefined);
  assert.equal(t.last(fred('hotspots')), 9);
  assert.match(t.gladys.fake.connectionStatus.message.en, /answer over/);
});

test('getConfig failing in `connected`: retried without end, the status says so, then the start', async () => {
  const t = await setup();
  let fails = 3;
  await t.app.connected(async () => {
    if (fails > 0) {
      fails -= 1;
      throw Object.assign(new Error('boom'), { status: 500 });
    }
    return { radius_km: 100 };
  });
  assert.equal(t.gladys.fake.connectionStatus.connected, false);
  assert.match(t.gladys.fake.connectionStatus.message.en, /Waiting for the configuration/);
  assert.equal(t.server.requests.length, 0);
  await t.wait(5 * SECOND);
  await t.wait(10 * SECOND);
  await t.wait(20 * SECOND);
  await t.wait(30 * SECOND);
  assert.equal(fails, 0);
  assert.equal(t.last(fred('hotspots')), 9);
});

test('a disconnection stops the retries of getConfig', async () => {
  const t = await setup();
  let calls = 0;
  await t.app.connected(async () => {
    calls += 1;
    throw new Error('boom');
  });
  await t.app.stop();
  await t.wait(HOUR);
  assert.equal(calls, 1);
});

test('the houses unreadable (location refused): nothing sent, tried again a minute later', async () => {
  const t = await setup();
  const getHouses = t.gladys.getHouses.bind(t.gladys);
  let refuse = true;
  t.gladys.getHouses = async () => {
    if (refuse) throw Object.assign(new Error('forbidden'), { status: 403 });
    return getHouses();
  };
  await t.start();
  assert.equal(t.server.requests.length, 0);
  assert.match(t.gladys.fake.connectionStatus.message.en, /houses of Gladys could not be read/);
  refuse = false;
  await t.wait(61 * SECOND);
  assert.equal(t.last(fred('hotspots')), 9);
  assert.deepEqual(
    t.gladys.fake.discoveredDevices.map((d) => d.external_id),
    [DEVICE('fredericton')],
  );
});

test('a device whose house is gone is said, not read', async () => {
  const t = await setup({ houses: [] });
  await t.start();
  assert.equal(t.server.requests.length, 0);
  assert.match(
    t.gladys.fake.connectionStatus.message.en,
    /no longer exists or is no longer located/,
  );
});

test('scene events: a hotspot appearing within a distance, once per episode, re-armed after 2 empty reads', async () => {
  const server = createServer();
  let hotspots = { type: 'FeatureCollection', features: [] };
  server.answer = (route) => (route === 'hotspots' ? hotspots : undefined);
  const t = await setup({ server });
  await t.start();
  assert.deepEqual(t.gladys.fake.sceneEvents, []);
  hotspots = fixture('hotspots-fredericton');
  await t.wait(30 * MINUTE + 30 * SECOND);
  const events = t.gladys.fake.sceneEvents.filter((e) => e.key === 'hotspot_nearby');
  assert.deepEqual(
    events.map((e) => e.data.distance),
    ['50', '100', '200', '300'],
  );
  const e50 = events[0].data;
  assert.equal(e50.house, DEVICE('fredericton'));
  assert.equal(e50.km, 38.5);
  assert.equal(typeof e50.direction, 'string');
  assert.match(e50.detected_at, /^2026-10-29T/);
  // Still there: no new event.
  await t.wait(30 * MINUTE + 30 * SECOND);
  assert.equal(t.gladys.fake.sceneEvents.length, 4);
  // One empty read does not re-arm; two do.
  hotspots = { type: 'FeatureCollection', features: [] };
  await t.wait(30 * MINUTE + 30 * SECOND);
  hotspots = fixture('hotspots-fredericton');
  await t.wait(30 * MINUTE + 30 * SECOND);
  assert.equal(t.gladys.fake.sceneEvents.length, 4);
  hotspots = { type: 'FeatureCollection', features: [] };
  await t.wait(30 * MINUTE + 30 * SECOND);
  await t.wait(30 * MINUTE + 30 * SECOND);
  hotspots = fixture('hotspots-fredericton');
  await t.wait(30 * MINUTE + 30 * SECOND);
  assert.equal(t.gladys.fake.sceneEvents.length, 8);
});

test('scene events: the danger raised from low to high fires each level crossed, kept across a restart', async () => {
  const store = createMemoryStore();
  const server = createServer();
  const low = fixture('danger');
  for (const f of low.features) f.properties.GRIDCODE = 0;
  server.answer = (route) => (route === 'danger' ? low : undefined);
  const a = await setup({ store, server });
  await a.start();
  await a.app.stop();
  assert.equal(store.data.memories[DEVICE('fredericton')].danger, 1);
  const b = await setup({ store, now: NOW + 40 * MINUTE });
  await b.start();
  const events = b.gladys.fake.sceneEvents.filter((e) => e.key === 'fire_danger_raised');
  assert.deepEqual(
    events.map((e) => e.data.level),
    ['2', '3'],
  );
  assert.equal(events[1].data.level_name, 'Élevé');
  assert.equal(events[1].data.previous_level, 1);
  assert.equal(events[1].data.fwi, 11);
});

test('the test button never reads sooner than the interval', async () => {
  const t = await setup();
  await t.start();
  const sent = t.server.requests.length;
  const answer = await t.app.testConnection();
  assert.equal(t.server.requests.length, sent);
  assert.match(answer.en, /9 hotspot\(s\)/);
  assert.match(answer.en, /Next read at/);
});

test('the test button without a device: one small request when due, counted as the read', async () => {
  const t = await setup({ devices: [] });
  await t.start();
  const promise = t.app.testConnection();
  await t.wait(5 * SECOND);
  const answer = await promise;
  assert.deepEqual(
    t.server.requests.map((r) => r.route),
    ['hotspots-newest'],
  );
  assert.match(answer.en, /server answers; newest hotspot: 2026-10-29 20:40 UTC/);
  await t.app.testConnection();
  assert.equal(t.server.requests.length, 1);
});

test('/data unwritable never blocks the reads', async () => {
  const store = createMemoryStore();
  store.failSave = true;
  const t = await setup({ store });
  await t.start();
  assert.equal(t.last(fred('hotspots')), 9);
});

test('a restart of Gladys (connected again) never republishes old values: they come with the next read', async () => {
  const t = await setup();
  await t.start();
  const published = t.gladys.fake.states.length;
  await t.app.connected(async () => ({ radius_km: 100 }));
  await t.wait(SECOND);
  assert.equal(t.gladys.fake.states.length, published);
  await t.wait(30 * MINUTE);
  assert.ok(t.gladys.fake.states.length > published, 'all sent again after forgetPublishedStates');
});

test('stop: no timer left, no read after it', async () => {
  const t = await setup();
  await t.start();
  await t.app.stop();
  const sent = t.server.requests.length;
  await t.wait(3 * HOUR);
  assert.equal(t.server.requests.length, sent);
  assert.equal(t.live.size, 0);
});

test('a stop during a read: the read gives up without publishing', async () => {
  const server = createServer();
  let release;
  server.answer = (route) =>
    route === 'hotspots' ? new Promise((resolve) => (release = resolve)) : undefined;
  const t = await setup({ server });
  await t.app.start({ radius_km: 100 });
  await t.wait(10 * SECOND);
  assert.ok(release);
  const stopping = t.app.stop();
  release(fixture('hotspots-fredericton'));
  await t.wait(10 * SECOND);
  await stopping;
  assert.equal(t.gladys.fake.states.length, 0);
});

test('the scene event and the states of a house are bounded and well formed', async () => {
  const t = await setup();
  await t.start();
  for (const s of t.gladys.fake.states) {
    if ('text' in s) assert.ok(s.text.length <= 200);
    else assert.ok(Number.isFinite(s.state));
  }
  const status = t.gladys.fake.connectionStatus.message;
  assert.ok(status.en.length <= 900 && status.fr.length <= 900);
});

test('json helper is a Response', () => {
  assert.ok(json({}) instanceof Response);
});

test('a house in a gap of the danger map (a lake): no class, but the perimeters are read', async () => {
  const server = createServer();
  const gap = fixture('danger');
  // The polygons of the box stay, none of them holds the house any more.
  for (const f of gap.features) {
    f.geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [-66.69, 45.91],
          [-66.68, 45.91],
          [-66.68, 45.92],
          [-66.69, 45.91],
        ],
      ],
    };
  }
  server.answer = (route) => (route === 'danger' ? gap : undefined);
  const t = await setup({ server });
  await t.start();
  assert.equal(t.last(fred('danger')), undefined);
  assert.equal(t.last(fred('active_perimeters')), 1);
  assert.match(t.gladys.fake.connectionStatus.message.en, /no danger class at this point/);
});

test('a configuration saved while getConfig is still running wins', async () => {
  const t = await setup();
  let answer;
  const pending = t.app.connected(() => new Promise((resolve) => (answer = resolve)));
  await t.app.start({ radius_km: 20 });
  answer({ radius_km: 100 });
  await pending;
  await t.wait(30 * SECOND);
  assert.equal(t.app.config.radiusKm, 20);
  assert.equal(t.last(fred('nearest_hotspot_km')), 20);
});

test('redirects are refused (the answer must come from the CWFIS itself)', async () => {
  const t = await setup();
  await t.start();
  for (const r of t.server.requests) assert.equal(r.redirect, 'error');
});

test('a read asked when not due sends nothing', async () => {
  const t = await setup();
  await t.start();
  const sent = t.server.requests.length;
  await t.app.tick();
  await t.app.tick({ probe: true });
  assert.equal(t.server.requests.length, sent);
});

test('the houses failing after a read: tried once a minute, never a loop, never sooner than the interval', async () => {
  const t = await setup();
  await t.start();
  const sent = t.server.requests.length;
  let calls = 0;
  t.gladys.getHouses = async () => {
    calls += 1;
    throw Object.assign(new Error('forbidden'), { status: 403 });
  };
  await t.wait(40 * MINUTE);
  assert.equal(t.server.requests.length, sent);
  assert.ok(calls >= 5 && calls <= 12, `${calls} calls`);
});

test('the danger map is read again after 6 hours, even with the same date', async () => {
  const t = await setup();
  await t.start();
  assert.equal(t.server.count('danger'), 1);
  await t.wait(5 * HOUR);
  assert.equal(t.server.count('danger'), 1);
  await t.wait(1.6 * HOUR);
  assert.equal(t.server.count('danger'), 2);
});
