// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout) sped
// up 20 times, against a real local HTTP server playing the CWFIS GeoServer
// with the captures: the reads really start at 0, the interval and twice the
// interval (never sooner, late only by the load), one request at a time, with
// a bounded number of timers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { FeuxApp } from '../src/app.js';
import { CwfisClient } from '../src/cwfis.js';
import { createMemoryStore } from '../src/store.js';
import { measurePeriod, realClock, spyOn } from './kit/clock.mjs';
import { HOUSES, SELECTOR, created, defaults, routeOf } from './helpers/app.js';

const SPEED = 20;
const INTERVAL = 60_000;

test('real clock x20: reads at the interval, never sooner; one request at a time', async (t) => {
  let inFlight = 0;
  let peak = 0;
  const server = createServer((req, res) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    const url = `https://cwfis.cfs.nrcan.gc.ca${req.url}`;
    const body = defaults[routeOf(url)]?.(url);
    setTimeout(() => {
      res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body ?? {}));
      inFlight -= 1;
    }, 5);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const clock = realClock({ speed: SPEED });
  t.after(() => clock.close());
  const gladys = createFakeGladys({
    selector: SELECTOR,
    devices: [created()],
    houses: [HOUSES.fredericton],
  });
  await gladys.connect();
  const quiet = () => {};
  const app = new FeuxApp({
    gladys,
    logger: { info: quiet, warn: quiet, error: quiet, debug: quiet },
    now: clock.now,
    monotonic: clock.monotonic,
    timers: clock.timers,
    store: createMemoryStore(),
    client: new CwfisClient({
      monotonic: clock.monotonic,
      timers: clock.timers,
      baseUrl: `http://127.0.0.1:${server.address().port}`,
    }),
    intervalMs: INTERVAL,
  });
  const spy = spyOn(app, 'readHouses', clock);
  await app.start({ radius_km: 100 });
  let gaps;
  try {
    gaps = await measurePeriod(spy, { count: 3, period: INTERVAL });
  } finally {
    // Stopped whatever the outcome: a failure never leaves the app running
    // its real timers, which would keep the test process (and a CI job) alive.
    await app.stop();
  }
  assert.equal(gaps.length, 2);
  assert.equal(peak, 1, 'never two requests at once');
  assert.ok(clock.timersSet < 60, `${clock.timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.ok(gladys.fake.states.some((s) => s.device_feature_external_id.endsWith(':hotspots')));
});
