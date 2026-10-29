// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a fake CWFIS server (the real
// captures of test/fixtures, routed by layer) and a virtual clock that moves
// at every read.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FeuxApp } from '../../src/app.js';
import { CwfisClient } from '../../src/cwfis.js';
import { buildHouseDevice } from '../../src/devices.js';
import { createMemoryStore } from '../../src/store.js';
import { settle, testClock } from '../kit/clock.mjs';

export const SELECTOR = 'feux-canada';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
/** The captures were made on 2026-10-29 around 21:18 UTC. */
export const NOW = Date.parse('2026-10-29T21:20:00Z');

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

export const HOUSES = {
  fredericton: {
    id: 'h1',
    name: 'Fredericton',
    selector: 'fredericton',
    latitude: 45.9636,
    longitude: -66.6431,
  },
  portland: {
    id: 'h2',
    name: 'Portland',
    selector: 'portland',
    latitude: 45.5152,
    longitude: -122.6784,
  },
  nowhere: { id: 'h3', name: 'Unlocated', selector: 'nowhere', latitude: null, longitude: null },
};

export const F = (selector, key) => `ext:${SELECTOR}:house:${selector}:${key}`;
export const DEVICE = (selector) => `ext:${SELECTOR}:house:${selector}`;

/** The device of a house as the user created it. */
export function created(house = HOUSES.fredericton) {
  return buildHouseDevice(createFakeGladys({ selector: SELECTOR }), house, 'fr');
}

/** The layer a request asks for: 'hotspots', 'hotspots-newest', ..., 'legend'. */
export function routeOf(url) {
  const u = new URL(url);
  if (u.pathname.endsWith('/wms')) return 'legend';
  const layer = {
    'public:hotspots_last24hrs': 'hotspots',
    'public:m3_polygons_current': 'perimeters',
    'public:firewx_stns_current': 'stations',
    'public:fdr_current_shp': 'danger',
  }[u.searchParams.get('typeNames')];
  return u.searchParams.get('sortBy') ? `${layer}-newest` : layer;
}

/** The default answers: the captures (Portland's hotspots for a box in the west). */
export const defaults = {
  'hotspots-newest': () => fixture('hotspots-newest'),
  'perimeters-newest': () => fixture('perimeters-newest'),
  legend: () => fixture('danger-legend'),
  hotspots: (url) =>
    new URL(url).searchParams.get('CQL_FILTER').includes('(geometry,-12')
      ? fixture('hotspots-portland')
      : fixture('hotspots-fredericton'),
  perimeters: () => fixture('perimeters'),
  stations: () => fixture('stations'),
  danger: (url) =>
    new URL(url).searchParams.get('CQL_FILTER').includes('(the_geom,-12')
      ? { type: 'FeatureCollection', features: [], numberMatched: 0 }
      : fixture('danger'),
};

export const json = (body, init = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });

/**
 * A fake CWFIS: `server.answer(route, url, init)` -> a body, a Response,
 * 'hang' (never answers, aborted by the signal), or undefined (the default).
 * Records every request with its route and headers, and the requests in
 * flight at once (`peak`).
 */
export function createServer() {
  const server = { requests: [], inFlight: 0, peak: 0, answer: () => undefined };
  server.fetch = async (url, init = {}) => {
    const route = routeOf(url);
    server.requests.push({ url, route, headers: init.headers, redirect: init.redirect });
    server.inFlight += 1;
    server.peak = Math.max(server.peak, server.inFlight);
    try {
      let answer = await server.answer(route, url, init);
      if (answer === 'hang') {
        await new Promise((resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      if (answer === undefined) answer = defaults[route]?.(url);
      if (answer instanceof Response) return answer;
      return answer === undefined ? new Response('not found', { status: 404 }) : json(answer);
    } finally {
      server.inFlight -= 1;
    }
  };
  server.count = (route) => server.requests.filter((r) => r.route === route).length;
  return server;
}

export async function setup({
  devices = [created()],
  houses = [HOUSES.fredericton],
  store = createMemoryStore(),
  config = { radius_km: 100 },
  server = createServer(),
  now = NOW,
  wallOffset = { ms: 0 },
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices, houses });
  await gladys.connect();
  const clock = testClock({ start: now });
  // The timers of the app, with their due time: `wait` jumps from one to the next.
  const live = new Map();
  const timers = {
    setTimeout(fn, ms, ...args) {
      const h = clock.timers.setTimeout(() => {
        live.delete(h);
        fn(...args);
      }, ms);
      live.set(h, clock.elapsed + Math.max(0, Number(ms) || 0));
      return h;
    },
    clearTimeout(h) {
      live.delete(h);
      clock.timers.clearTimeout(h);
    },
  };
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const client = new CwfisClient({
    fetchImpl: server.fetch,
    monotonic: clock.monotonic,
    timers,
  });
  const app = new FeuxApp({
    gladys,
    logger: { info: log, warn: log, error: log, debug: log },
    now: () => clock.now() + wallOffset.ms,
    monotonic: clock.monotonic,
    timers,
    store,
    client,
  });
  /**
   * Moves the clock on by `ms`, from one timer of the app to the next, letting
   * every request, save and promise of the way run in between.
   */
  const wait = async (ms) => {
    const end = clock.elapsed + ms;
    for (let guard = 0; guard < 10_000; guard += 1) {
      await settle(20);
      const next = Math.min(...live.values());
      if (!(next <= end)) break;
      await clock.advance(Math.max(0, next - clock.elapsed));
    }
    await clock.advance(Math.max(0, end - clock.elapsed));
    await settle(20);
  };
  const start = async (cfg = config) => {
    await app.start(cfg);
    await wait(30 * SECOND);
  };
  const last = (featureId) => {
    const states = gladys.fake.states.filter((s) => s.device_feature_external_id === featureId);
    const s = states.at(-1);
    return s === undefined ? undefined : (s.state ?? s.text);
  };
  return { app, gladys, clock, timers, live, store, server, start, wait, lines, last };
}
