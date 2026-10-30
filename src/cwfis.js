// -----------------------------------------------------------------------------
// The client of the CWFIS GeoServer: the WFS requests (GeoJSON in EPSG:4326,
// longitude/latitude; the layers are stored in a Lambert projection), one at a
// time with a pause between two, and the strict reading of each feature: a
// missing or non-numeric value is unknown, never 0.
// -----------------------------------------------------------------------------

import {
  DANGER_LEGEND_LAYER,
  LAYERS,
  MAX_BODY,
  MAX_FEATURES,
  MAX_VERTICES,
  REQUEST_SPACING,
  WFS_URL,
  WMS_URL,
} from './constants.js';
import { vertexCount } from './geo.js';
import { SourceError, getJson } from './http.js';

/** A finite number, from a JSON number or a plain decimal text; undefined otherwise. */
export function strictNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

/** An ISO date with its zone (as GeoServer writes them) -> epoch ms; undefined otherwise. */
export function strictDate(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(value)
  ) {
    return undefined;
  }
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
}

/** A text of the source: control characters to spaces, spaces collapsed, bounded. */
const text = (value, max = 120) =>
  typeof value === 'string'
    ? [...value.slice(0, 4 * max)]
        .map((c) => (c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f ? ' ' : c))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

const latitudeOf = (v) => {
  const n = strictNumber(v);
  return n !== undefined && n >= -90 && n <= 90 ? n : undefined;
};
const longitudeOf = (v) => {
  const n = strictNumber(v);
  return n !== undefined && n >= -180 && n <= 180 ? n : undefined;
};

/** The features of a GeoJSON FeatureCollection, or a SourceError for anything else. */
export function featuresOf(body, what) {
  if (
    !body ||
    typeof body !== 'object' ||
    body.type !== 'FeatureCollection' ||
    !Array.isArray(body.features)
  ) {
    throw new SourceError('bad_answer', `${what}: not a feature collection`);
  }
  const matched = strictNumber(body.numberMatched);
  return {
    features: body.features.filter((f) => f && typeof f === 'object' && f.properties),
    matched: matched === undefined ? undefined : matched,
  };
}

/** A hotspot: position, time and satellite; undefined when the position or time is unreadable. */
export function parseHotspot(feature) {
  const p = feature.properties;
  const latitude = latitudeOf(p.lat);
  const longitude = longitudeOf(p.lon);
  const at = strictDate(p.rep_date);
  if (latitude === undefined || longitude === undefined || at === undefined) {
    return undefined;
  }
  return {
    id: text(String(feature.id ?? ''), 80),
    latitude,
    longitude,
    at,
    sensor: text(p.sensor, 20),
    satellite: text(p.satellite, 20),
    agency: text(p.agency, 8),
  };
}

/** A perimeter (M3 polygon): outline, hotspot count and the dates of its first and last hotspot. */
export function parsePerimeter(feature) {
  const p = feature.properties;
  const lastAt = strictDate(p.lastdate);
  const geometry = feature.geometry;
  // A geometry without any ring (a point, an empty polygon) is unreadable, never "none near".
  if (lastAt === undefined || vertexCount(geometry) === 0) {
    return undefined;
  }
  const hcount = strictNumber(p.hcount);
  const area = strictNumber(p.area);
  return {
    id: text(String(feature.id ?? ''), 80),
    geometry,
    firstAt: strictDate(p.firstdate),
    lastAt,
    hotspots: hcount !== undefined && Number.isInteger(hcount) && hcount >= 0 ? hcount : undefined,
    area: area !== undefined && area >= 0 ? area : undefined,
  };
}

/**
 * A fire weather station: its identity is the AES (Environment Canada)
 * number, else the WMO one (the feature id changes at every request). The
 * FWI is undefined when missing or negative.
 */
export function parseStation(feature) {
  const p = feature.properties;
  const latitude = latitudeOf(p.lat);
  const longitude = longitudeOf(p.lon);
  const at = strictDate(p.rep_date);
  const aes = text(String(p.aes ?? ''), 16);
  const wmo = strictNumber(p.wmo);
  const id = aes ? `aes-${aes}` : Number.isInteger(wmo) ? `wmo-${wmo}` : '';
  if (latitude === undefined || longitude === undefined || at === undefined || !id) {
    return undefined;
  }
  const fwi = strictNumber(p.fwi);
  return {
    id,
    // The names come with '+' for their spaces ("FREDERICTON+CDA+CS").
    name: text(typeof p.name === 'string' ? p.name.replaceAll('+', ' ') : '', 60) || id,
    province: text(p.prov, 4),
    latitude,
    longitude,
    at,
    fwi: fwi !== undefined && fwi >= 0 ? fwi : undefined,
  };
}

/** A polygon of the fire danger map: GRIDCODE 0 (low) to 4 (extreme); undefined otherwise. */
export function parseDangerArea(feature) {
  const code = strictNumber(feature.properties.GRIDCODE);
  if (
    code === undefined ||
    !Number.isInteger(code) ||
    code < 0 ||
    code > 4 ||
    vertexCount(feature.geometry) === 0
  ) {
    return undefined;
  }
  return { code, geometry: feature.geometry };
}

/** The date ending the title of the danger map legend ("... - 2026-10-29"), or undefined. */
export function parseLegendDate(body) {
  const title = body?.Legend?.[0]?.title;
  const match = typeof title === 'string' ? /(\d{4}-\d{2}-\d{2})\s*$/.exec(title) : null;
  if (!match) {
    return undefined;
  }
  const at = Date.parse(`${match[1]}T00:00:00Z`);
  return Number.isFinite(at) ? match[1] : undefined;
}

const cqlBox = (geometry, box) =>
  `BBOX(${geometry},${box.west},${box.south},${box.east},${box.north},'EPSG:4326')`;

const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The URL of a GetFeature request. */
export function featureUrl(layer, { filter, count, sortBy, properties = layer.properties } = {}) {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: layer.name,
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
  });
  if (properties?.length) params.set('propertyName', properties.join(','));
  if (count) params.set('count', String(count));
  if (sortBy) params.set('sortBy', sortBy);
  if (filter) params.set('CQL_FILTER', filter);
  return `${WFS_URL}?${params}`;
}

export class CwfisClient {
  /**
   * `monotonic` and `timers` pace the requests; `fetchImpl` is the network
   * (tests: a fake or a local server, with `baseUrl` replacing the host).
   */
  constructor({
    fetchImpl = globalThis.fetch,
    monotonic = () => performance.now(),
    timers = globalThis,
    baseUrl,
  } = {}) {
    this.fetchImpl = fetchImpl;
    this.monotonic = monotonic;
    this.timers = timers;
    this.baseUrl = baseUrl;
    /** One request at a time: each waits for the previous one and the spacing. */
    this.queue = Promise.resolve();
    this.lastEndAt = -Infinity;
    /** Every request sent (tests, status). */
    this.sent = 0;
  }

  rebase(url) {
    if (!this.baseUrl) return url;
    const u = new URL(url);
    return `${this.baseUrl}${u.pathname}${u.search}`;
  }

  /** Serialized and spaced: never two requests at once, never closer than REQUEST_SPACING. */
  request(url, options) {
    const run = async () => {
      const wait = this.lastEndAt + REQUEST_SPACING - this.monotonic();
      if (wait > 0) {
        await new Promise((resolve) => this.timers.setTimeout(resolve, wait));
      }
      this.sent += 1;
      try {
        return await getJson(this.rebase(url), {
          ...options,
          fetchImpl: this.fetchImpl,
          timers: this.timers,
        });
      } finally {
        this.lastEndAt = this.monotonic();
      }
    };
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  /** The newest report date of a whole layer (one feature, sorted): epoch ms, null when empty. */
  async newest(kind) {
    const layer = LAYERS[kind];
    const field = kind === 'perimeters' ? 'lastdate' : 'rep_date';
    const body = await this.request(
      featureUrl(layer, { count: 1, sortBy: `${field} D`, properties: [field] }),
      { maxBytes: MAX_BODY.small },
    );
    const { features } = featuresOf(body, kind);
    if (features.length === 0) {
      return null;
    }
    const at = strictDate(features[0].properties[field]);
    if (at === undefined) {
      throw new SourceError('bad_answer', `${kind}: unreadable date`);
    }
    return at;
  }

  /** The hotspots of the last 24 h in the box. */
  async hotspots(box) {
    const layer = LAYERS.hotspots;
    const body = await this.request(
      featureUrl(layer, { filter: cqlBox(layer.geometry, box), count: MAX_FEATURES.hotspots }),
      { maxBytes: MAX_BODY.hotspots },
    );
    const { features, matched } = featuresOf(body, 'hotspots');
    const parsed = features.map(parseHotspot);
    return {
      items: parsed.filter(Boolean),
      unreadable: parsed.filter((h) => !h).length,
      truncated: matched !== undefined && matched > features.length,
    };
  }

  /** The perimeters in the box touched by a hotspot since `since` (epoch ms). */
  async perimeters(box, since) {
    const layer = LAYERS.perimeters;
    const body = await this.request(
      featureUrl(layer, {
        filter: `${cqlBox(layer.geometry, box)} AND lastdate >= '${isoSeconds(since)}'`,
        count: MAX_FEATURES.perimeters,
      }),
      { maxBytes: MAX_BODY.perimeters },
    );
    const { features, matched } = featuresOf(body, 'perimeters');
    const parsed = features.map(parsePerimeter);
    const items = parsed.filter(Boolean);
    if (items.reduce((n, p) => n + vertexCount(p.geometry), 0) > MAX_VERTICES) {
      throw new SourceError('too_large', 'perimeters: too many vertices');
    }
    return {
      items,
      unreadable: parsed.length - items.length,
      truncated: matched !== undefined && matched > features.length,
    };
  }

  /** The fire weather stations in the box: an unreadable record fails the read (never dropped). */
  async stations(box) {
    const layer = LAYERS.stations;
    const body = await this.request(
      featureUrl(layer, { filter: cqlBox(layer.geometry, box), count: MAX_FEATURES.stations }),
      { maxBytes: MAX_BODY.stations },
    );
    const { features } = featuresOf(body, 'stations');
    const items = features.map(parseStation);
    if (items.some((s) => !s)) {
      throw new SourceError('bad_answer', 'stations: unreadable record(s)');
    }
    return items;
  }

  /** The polygons of the fire danger map in the box. */
  async dangerAreas(box) {
    const layer = LAYERS.danger;
    const body = await this.request(
      featureUrl(layer, { filter: cqlBox(layer.geometry, box), count: MAX_FEATURES.danger }),
      { maxBytes: MAX_BODY.danger },
    );
    const { features, matched } = featuresOf(body, 'danger');
    if (matched !== undefined && matched > features.length) {
      throw new SourceError('too_large', 'danger: more polygons than one answer holds');
    }
    const items = features.map(parseDangerArea);
    // A polygon of an unknown class is an error, never a gap of the map.
    if (items.some((a) => !a)) {
      throw new SourceError('bad_answer', 'danger: unreadable polygon(s)');
    }
    if (items.reduce((n, a) => n + vertexCount(a.geometry), 0) > MAX_VERTICES) {
      throw new SourceError('too_large', 'danger: too many vertices');
    }
    return items;
  }

  /** The date of the danger map ("YYYY-MM-DD", UTC day), from its WMS legend; undefined if unreadable. */
  async dangerDate() {
    const params = new URLSearchParams({
      service: 'WMS',
      version: '1.1.1',
      request: 'GetLegendGraphic',
      layer: DANGER_LEGEND_LAYER,
      format: 'application/json',
    });
    const body = await this.request(`${WMS_URL}?${params}`, { maxBytes: MAX_BODY.small });
    return parseLegendDate(body);
  }
}
