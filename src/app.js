// -----------------------------------------------------------------------------
// The integration: the located houses of Gladys offered in Discovery, one
// read of the CWFIS layers per interval for the houses whose device exists
// (one request at a time), the states, the scene events, the status and the
// test button. index.js only wires the SDK to it. Read only: nothing is ever
// commanded.
//
// Two clocks: `now` (wall clock) dates what /data keeps and is compared with
// the dates of the source; `monotonic` paces the reads and the pauses, so that
// a wall clock set back or forward never stops nor hurries them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  CONFIG_RETRY,
  DANGER_BOX,
  DANGER_REFRESH,
  HOTSPOTS_MAX_AGE,
  MAX_HOUSES,
  PAUSE,
  PERIMETERS_MAX_AGE,
  PERIMETER_ACTIVE,
  STATE_HEARTBEAT,
  STATION_SEARCH_KM,
  STOP_WAIT,
} from './constants.js';
import { CwfisClient } from './cwfis.js';
import { buildHouseDevice, houseStates, parseExternalId, validSelector } from './devices.js';
import { boundingBox, containsPoint, degreeBox } from './geo.js';
import { T, joinLines } from './i18n.js';
import { dangerPart, hotspotsPart, perimetersPart, stationPart } from './model.js';
import { createFileStore } from './store.js';
import { houseEvents, validMemory } from './triggers.js';

const defaultTimers = { setTimeout, clearTimeout };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const located = (h) =>
  finite(h?.latitude) &&
  finite(h?.longitude) &&
  Math.abs(h.latitude) <= 90 &&
  Math.abs(h.longitude) <= 180 &&
  validSelector(h?.selector);
/** Errors after which the whole read stops: the server asks to wait. */
const PAUSING = new Set(['rate_limited', 'server']);
/** Errors after which the read stops for now: the server cannot be reached. */
const UNREACHABLE = new Set(['timeout', 'network']);

/** A pause read back from /data: `{ until, count, status }`; in memory it ends at a monotonic `due`. */
function validPause(pause, now, mono) {
  if (!pause || !finite(pause.until) || !Number.isInteger(pause.count) || pause.count < 1) {
    return undefined;
  }
  const left = Math.min(Math.max(0, pause.until - now), PAUSE.max);
  return {
    until: now + left,
    due: mono + left,
    count: Math.min(pause.count, 32),
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

export class FeuxApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'feux-canada' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    store = createFileStore(),
    client,
    intervalMs,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.store = store;
    this.client = client ?? new CwfisClient({ monotonic, timers });
    this.config = normalizeConfig();
    /** Tests on the real clock only: the interval, in place of the configuration's. */
    this.intervalMs = intervalMs;
    this.running = false;
    this.timer = undefined;
    this.busy = undefined;
    this.loopRun = Promise.resolve();
    this.lifecycle = Promise.resolve();
    this.lastStatus = undefined;
    this.generation = 0;
    this.configRetry = undefined;
    /** selector -> house (getHouses), the located ones. */
    this.houses = new Map();
    this.housesError = false;
    /** selector -> { key, date, readAt (monotonic), part }: the danger is a daily map. */
    this.dangerCache = new Map();
    /** device external id -> last reading (this session). */
    this.readings = new Map();
    /** The outcome of the last read, for the status and the test button. */
    this.outcome = undefined;

    const { data: kept } = store.load();
    const at = now();
    const mono = monotonic();
    this.pause = validPause(kept.pause, at, mono);
    // The last read before a restart: the next one never comes sooner than the
    // interval (a date in the future, a clock set back, is brought to now).
    this.lastAttemptAt = finite(kept.lastAttemptAt) ? Math.min(kept.lastAttemptAt, at) : undefined;
    this.lastReadAt =
      this.lastAttemptAt === undefined ? undefined : mono - (at - this.lastAttemptAt);
    /** device external id -> memory of the triggers (kept in /data). */
    this.memories = new Map();
    for (const [id, memory] of Object.entries(kept.memories ?? {})) {
      const valid = parseExternalId(id) && validMemory(memory, at);
      if (valid) this.memories.set(id, valid);
    }
    /** Retry of a read that could not start (houses unreadable): monotonic. */
    this.nextTryAt = undefined;
  }

  // --- /data ---------------------------------------------------------------------

  async saveState() {
    const memories = Object.fromEntries(
      [...this.memories].map(([id, m]) => [id, { at: m.at, zones: m.zones, danger: m.danger }]),
    );
    const pause = this.pause && {
      until: this.pause.until,
      count: this.pause.count,
      status: this.pause.status,
    };
    try {
      await this.store.save({ lastAttemptAt: this.lastAttemptAt, pause, memories });
      return true;
    } catch (err) {
      this.logger.warn(`/data not written (${err?.code ?? err?.message ?? 'error'})`);
      return false;
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  /** Resolves once every queued start/stop and the read running are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.loopRun;
    await this.busy;
  }

  /**
   * The SDK is connected: the configuration, then the start. getConfig()
   * failing is retried, the delay doubled up to CONFIG_RETRY.max, never given
   * up, with the status saying so.
   */
  connected(getConfig) {
    this.cancelConfigRetry();
    const generation = ++this.generation;
    let attempt = 0;
    const tryOnce = async () => {
      this.configRetry = undefined;
      if (generation !== this.generation) return;
      attempt += 1;
      let config;
      try {
        config = await getConfig();
      } catch (err) {
        if (generation !== this.generation) return;
        this.logger.warn(`getConfig failed (${err?.status ?? err?.name ?? 'error'}), retrying`);
        this.lastStatus = undefined;
        await this.setStatus(false, T.waitingConfig(attempt));
        if (generation !== this.generation) return;
        const delay = Math.min(CONFIG_RETRY.max, CONFIG_RETRY.min * 2 ** (attempt - 1));
        this.configRetry = this.timers.setTimeout(() => {
          this.configRun = tryOnce();
        }, delay);
        return;
      }
      if (generation !== this.generation) return;
      await this.start(config);
    };
    this.configRun = tryOnce();
    return this.configRun;
  }

  cancelConfigRetry() {
    if (this.configRetry !== undefined) {
      this.timers.clearTimeout(this.configRetry);
      this.configRetry = undefined;
    }
  }

  start(raw = {}) {
    this.cancelConfigRetry();
    // A getConfig() still running for an older connection gives up.
    this.generation += 1;
    return this.serialize(() => this.doStart(raw));
  }

  /** Stops the reads, waits (bounded) for the one running, and writes /data. */
  stop() {
    this.cancelConfigRetry();
    this.generation += 1;
    return this.serialize(async () => {
      this.doStop();
      await this.saveState();
      if (this.busy) {
        let timer;
        await Promise.race([
          this.busy.catch(() => {}),
          new Promise((resolve) => {
            timer = this.timers.setTimeout(resolve, STOP_WAIT);
          }),
        ]);
        this.timers.clearTimeout(timer);
        await this.saveState();
      }
    });
  }

  async doStart(raw) {
    this.doStop();
    const previous = this.config;
    this.config = normalizeConfig(raw);
    if (previous.radiusKm !== this.config.radiusKm) {
      // Another radius: the zones of the triggers are not comparable.
      for (const memory of this.memories.values()) memory.zones = {};
    }
    this.running = true;
    this.session = {};
    // The core keeps the status, the Discovery list and the last values in
    // memory: a restarted Gladys has lost them, so they are sent again (the
    // values at the next read, never the old ones).
    this.lastStatus = undefined;
    this.gladys.forgetPublishedStates?.();
    await this.discover();
    await this.updateStatus();
    this.schedule();
  }

  doStop() {
    this.running = false;
    this.session = undefined;
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err?.message}`));
  }

  // --- Houses and Discovery --------------------------------------------------------

  /** The located houses of Gladys (getHouses needs `location: true`). */
  async loadHouses() {
    try {
      const houses = await this.gladys.getHouses();
      this.houses = new Map(
        (Array.isArray(houses) ? houses : []).filter(located).map((h) => [h.selector, h]),
      );
      this.housesError = false;
    } catch (err) {
      this.housesError = true;
      this.logger.warn(`Houses unavailable (${err?.status ?? err?.name ?? 'error'})`);
    }
  }

  async discover() {
    await this.loadHouses();
    await this.publishDiscovery({ force: true });
  }

  /** The devices of the located houses; sent again only when they changed (or `force`). */
  async publishDiscovery({ force = false } = {}) {
    if (this.housesError) return;
    const devices = [...this.houses.values()]
      .slice(0, MAX_HOUSES)
      .map((h) => buildHouseDevice(this.gladys, h, this.config.language));
    const signature = JSON.stringify(devices);
    if (!force && signature === this.discoveredSignature) return;
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discoveredSignature = signature;
    } catch (err) {
      this.discoveredSignature = undefined;
      this.logger.warn(`Discovery not published: ${err?.message}`);
    }
  }

  /** Scan asked by the user: the houses again, never a read of the source. */
  async scan() {
    await this.discover();
    await this.updateStatus();
  }

  /** The created devices and their house: `{ deviceId, name, house | undefined }`. */
  targets() {
    const list = [];
    for (const device of this.gladys.devices ?? []) {
      const parsed = parseExternalId(device?.external_id);
      if (!parsed) continue;
      list.push({
        deviceId: device.external_id,
        name: device.name ?? parsed.selector,
        house: this.houses.get(parsed.selector),
      });
    }
    return list;
  }

  async deviceChanged() {
    // A new device is read at the next read: never sooner than the interval.
    this.schedule();
    await this.updateStatus();
  }

  async deviceDeleted(device) {
    if (this.memories.delete(device?.external_id)) {
      await this.saveState();
    }
    this.readings.delete(device?.external_id);
    await this.updateStatus();
  }

  // --- Pace ------------------------------------------------------------------

  interval() {
    return this.intervalMs ?? this.config.pollMinutes * 60_000;
  }

  pauseLeft(mono) {
    return this.pause ? Math.min(Math.max(0, this.pause.due - mono), PAUSE.max) : 0;
  }

  /** The monotonic time from which the next read may start, from the caller's instant `mono`. */
  dueAt(mono) {
    let due = this.lastReadAt === undefined ? mono : this.lastReadAt + this.interval();
    if (this.nextTryAt !== undefined) due = Math.max(due, this.nextTryAt);
    return Math.max(due, mono + this.pauseLeft(mono));
  }

  schedule() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running) return;
    const mono = this.monotonic();
    const wait = Math.max(0, this.dueAt(mono) - mono);
    const session = this.session;
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.loopRun = this.loop(session);
    }, wait);
  }

  async loop(session) {
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`Unexpected error (${err?.name ?? 'Error'}: ${err?.message})`);
    }
    if (session === this.session && this.running) {
      this.schedule();
    }
  }

  /** One read when it is due; a read running is never doubled. */
  tick(options) {
    if (!this.busy) {
      this.busy = this.read(options).finally(() => {
        this.busy = undefined;
      });
    }
    return this.busy;
  }

  // --- Reading -------------------------------------------------------------------

  async read({ probe = false } = {}) {
    const session = this.session;
    if (!session || !this.running) return;
    const gone = () => session !== this.session || !this.running;
    const mono = this.monotonic();
    if (mono < this.dueAt(mono)) return;
    await this.loadHouses();
    if (gone()) return;
    if (this.housesError) {
      // Nothing was sent: tried again in a minute, not at the next interval.
      this.nextTryAt = mono + 60_000;
      await this.updateStatus();
      return;
    }
    this.nextTryAt = undefined;
    await this.publishDiscovery();
    if (gone()) return;
    const targets = this.targets()
      .filter((t) => t.house)
      .slice(0, MAX_HOUSES);
    if (targets.length === 0 && !probe) {
      await this.updateStatus();
      return;
    }
    // Kept BEFORE the first request: a restart during it never reads sooner.
    this.lastReadAt = mono;
    this.lastAttemptAt = this.now();
    await this.saveState();
    if (gone()) return;
    if (targets.length === 0) {
      await this.probe(gone);
      return;
    }
    await this.readHouses(targets, gone);
  }

  /** The test button without any device: one small request, counted as the read. */
  async probe(gone) {
    try {
      const newest = await this.client.newest('hotspots');
      if (gone()) return;
      this.pauseEnds();
      await this.saveState();
      if (gone()) return;
      this.outcome = { kind: 'probe', at: this.now(), newest };
    } catch (err) {
      if (gone()) return;
      await this.failed(err);
    }
  }

  pauseEnds() {
    if (this.pause) {
      this.pause = undefined;
    }
  }

  /** A 429/5xx: a pause, doubled at each one (Retry-After when longer), kept in /data. */
  async failed(err) {
    const mono = this.monotonic();
    if (PAUSING.has(err?.code)) {
      const count = (this.pause?.count ?? 0) + 1;
      const wanted = Math.max(PAUSE.min * 2 ** (count - 1), err.retryAfter ?? 0);
      const left = Math.min(PAUSE.max, wanted);
      this.pause = { until: this.now() + left, due: mono + left, count, status: err.status };
      this.outcome = { kind: 'paused', at: this.now() };
      await this.saveState();
    } else {
      this.outcome = { kind: 'unreachable', at: this.now(), message: err?.message ?? 'error' };
    }
    await this.updateStatus();
  }

  /** What is global to one read: are the hotspot and perimeter layers fresh, the date of the danger map. */
  async readLayers(now) {
    const layers = { hotspots: undefined, perimeters: undefined, dangerDate: undefined };
    for (const kind of ['hotspots', 'perimeters']) {
      try {
        const newest = await this.client.newest(kind);
        const maxAge = kind === 'hotspots' ? HOTSPOTS_MAX_AGE : PERIMETERS_MAX_AGE;
        layers[kind] =
          newest !== null && now - newest <= maxAge
            ? { fresh: true, newest }
            : { fresh: false, newest };
      } catch (err) {
        if (PAUSING.has(err.code) || UNREACHABLE.has(err.code)) throw err;
        layers[kind] = { error: err.message };
      }
    }
    try {
      layers.dangerDate = await this.client.dangerDate();
    } catch (err) {
      // Secondary: the map is read without its date (never called stale).
      if (PAUSING.has(err.code)) throw err;
      this.logger.warn(`Date of the danger map unread (${err.message})`);
    }
    return layers;
  }

  /**
   * The danger class at a house, and whether the house is on the map at all
   * (it covers Canada: the perimeters do too). The map is daily: its polygons
   * are read again with a new date, or after DANGER_REFRESH.
   */
  async dangerOf(house, date, now, mono) {
    const key = `${house.latitude},${house.longitude}`;
    let cached = this.dangerCache.get(house.selector);
    if (
      !cached ||
      cached.key !== key ||
      mono - cached.readAt >= DANGER_REFRESH ||
      (date !== undefined && cached.date !== date)
    ) {
      const areas = await this.client.dangerAreas(degreeBox(house, DANGER_BOX));
      const area = areas.find((a) => containsPoint(a.geometry, house));
      // On the map: any of its polygons near the house (a lake may be a gap of it).
      const covered = areas.length > 0;
      cached = { key, date, readAt: mono, area: area && { code: area.code }, covered };
      this.dangerCache.set(house.selector, cached);
    }
    return dangerPart(cached.area, { date, now, covered: cached.covered });
  }

  /** One part of a house: its value, or `{ status: 'error' }`; a pause or an unreachable server stops the read. */
  async part(name, job) {
    try {
      return await job();
    } catch (err) {
      if (PAUSING.has(err?.code) || UNREACHABLE.has(err?.code)) throw err;
      this.logger.warn(`${name}: ${err?.message}`);
      return { status: 'error', message: err?.message ?? 'error' };
    }
  }

  async readHouses(targets, gone) {
    const now = this.now();
    const mono = this.monotonic();
    const radius = this.config.radiusKm;
    let layers;
    try {
      layers = await this.readLayers(now);
    } catch (err) {
      if (gone()) return;
      await this.failed(err);
      return;
    }
    if (gone()) return;
    const results = [];
    let stopped;
    for (const target of targets) {
      const { house } = target;
      const reading = {};
      try {
        const box = boundingBox(house, radius);
        reading.hotspots = layers.hotspots.error
          ? { status: 'error', message: layers.hotspots.error }
          : !layers.hotspots.fresh
            ? { status: 'stale', newest: layers.hotspots.newest }
            : await this.part('hotspots', async () => {
                const r = await this.client.hotspots(box);
                return hotspotsPart(house, r.items, radius, { truncated: r.truncated });
              });
        if (gone()) return;
        reading.danger = await this.part('danger', () =>
          this.dangerOf(house, layers.dangerDate, now, mono),
        );
        if (gone()) return;
        // The perimeters cover Canada, as the danger map: off the map, none is not 0.
        reading.perimeters = layers.perimeters.error
          ? { status: 'error', message: layers.perimeters.error }
          : reading.danger.covered === false
            ? { status: 'outside' }
            : !layers.perimeters.fresh
              ? { status: 'stale', newest: layers.perimeters.newest }
              : await this.part('perimeters', async () => {
                  const r = await this.client.perimeters(box, now - PERIMETER_ACTIVE);
                  return perimetersPart(house, r.items, radius, { truncated: r.truncated });
                });
        if (gone()) return;
        reading.station = await this.part('station', async () =>
          stationPart(
            house,
            await this.client.stations(boundingBox(house, STATION_SEARCH_KM)),
            now,
            STATION_SEARCH_KM,
          ),
        );
        if (gone()) return;
      } catch (err) {
        if (gone()) return;
        stopped = err;
      }
      if (Object.keys(reading).length === 4) {
        results.push({ target, reading });
      }
      if (stopped) break;
    }
    for (const { target, reading } of results) {
      await this.publish(target, reading, now);
      if (gone()) return;
    }
    if (stopped) {
      await this.saveState();
      if (gone()) return;
      await this.failed(stopped);
      return;
    }
    // A whole read without a 429/5xx ends the pause.
    this.pauseEnds();
    await this.saveState();
    if (gone()) return;
    this.outcome = { kind: 'read', at: now, results, layers };
    await this.updateStatus();
  }

  /** States, scene events and the memory of one house. */
  async publish(target, reading, now) {
    this.readings.set(target.deviceId, reading);
    await this.gladys
      .publishChangedStates(houseStates(target.deviceId, reading, this.config.radiusKm), {
        heartbeat: STATE_HEARTBEAT,
      })
      .catch((err) => this.logger.warn(`States of ${target.name} not published: ${err?.message}`));
    const { events, memory } = houseEvents(this.memories.get(target.deviceId), reading, {
      deviceId: target.deviceId,
      language: this.config.language,
      now,
    });
    this.memories.set(target.deviceId, memory);
    for (const event of events) {
      await this.gladys
        .publishSceneEvent(event.key, event.data)
        .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err?.message}`));
    }
  }

  // --- Status --------------------------------------------------------------------

  async updateStatus() {
    if (!this.running) return;
    const mono = this.monotonic();
    const now = this.now();
    if (this.housesError) {
      await this.setStatus(false, T.housesUnavailable);
      return;
    }
    const targets = this.targets();
    if (targets.length === 0) {
      await this.setStatus(
        this.houses.size > 0,
        this.houses.size > 0
          ? T.noDevice(Math.min(this.houses.size, MAX_HOUSES))
          : T.noLocatedHouse,
      );
      return;
    }
    const lines = [];
    if (this.pause && this.pauseLeft(mono) > 0) {
      await this.setStatus(false, T.paused(now + this.pauseLeft(mono), this.pause.status ?? 429));
      return;
    }
    const outcome = this.outcome;
    if (outcome?.kind === 'unreachable') {
      const next = now + Math.max(0, this.dueAt(mono) - mono);
      await this.setStatus(false, T.unreachable(outcome.message, next));
      return;
    }
    let connected = false;
    if (outcome?.kind === 'read') {
      lines.push(T.read(outcome.results.length, outcome.at));
      const notes = new Map();
      for (const { target, reading } of outcome.results) {
        lines.push(T.house(target.name, reading));
        if (Object.values(reading).some((p) => p.status === 'ok')) connected = true;
        const { hotspots, perimeters, danger } = reading;
        if (hotspots.status === 'stale') notes.set('hs', T.hotspotsStale(hotspots.newest));
        if (perimeters.status === 'stale') notes.set('pe', T.perimetersStale(perimeters.newest));
        if (danger.status === 'stale') notes.set('ds', T.dangerStale(danger.date));
        for (const [key, part] of Object.entries(reading)) {
          if (part.status === 'error') notes.set(`e-${key}`, T.partFailed(key, part.message));
        }
      }
      lines.push(...notes.values());
      lines.push(T.caveat);
    }
    for (const t of targets) {
      if (!t.house) lines.push(T.orphan(t.name));
    }
    if (targets.filter((t) => t.house).length > MAX_HOUSES) {
      lines.push(T.tooManyHouses(MAX_HOUSES));
    }
    if (lines.length === 0) {
      // Not read yet in this session (a restart within the interval): not a failure.
      lines.push(T.test.notDue(now + Math.max(0, this.dueAt(mono) - mono)));
      connected = true;
    }
    await this.setStatus(connected, joinLines(lines));
  }

  // --- Test button ------------------------------------------------------------------

  /**
   * The test: a read when one is due (never sooner than the interval), else
   * the outcome of the last one and the time of the next.
   */
  async testConnection() {
    if (!this.running) {
      return T.notStarted;
    }
    const mono = this.monotonic();
    if (mono >= this.dueAt(mono)) {
      await this.tick({ probe: true });
      this.schedule();
    }
    const after = this.monotonic();
    const next = T.test.notDue(this.now() + Math.max(0, this.dueAt(after) - after));
    const outcome = this.outcome;
    if (!outcome) {
      return joinLines([T.test.never, next]);
    }
    if (outcome.kind === 'probe') {
      return joinLines([T.test.probeOk(outcome.newest), next]);
    }
    if (outcome.kind === 'read') {
      return joinLines([
        T.read(outcome.results.length, outcome.at),
        ...outcome.results.map(({ target, reading }) => T.house(target.name, reading)),
        next,
      ]);
    }
    if (outcome.kind === 'paused') {
      return T.paused(this.now() + this.pauseLeft(after), this.pause?.status ?? 429);
    }
    return T.unreachable(outcome.message, this.now() + Math.max(0, this.dueAt(after) - after));
  }
}
