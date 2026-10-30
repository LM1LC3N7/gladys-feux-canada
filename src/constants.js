// -----------------------------------------------------------------------------
// Constants of the Canada wildfires integration. Keys marked "forever" are
// stored in the user's devices, scenes or /data: never renamed.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

/**
 * The public WFS of the Canadian Wildland Fire Information System (CWFIS,
 * Natural Resources Canada), GeoServer, no key. Open Government Licence -
 * Canada.
 */
export const WFS_URL = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/ows';
/** The WMS of the same GeoServer: only the legend title (the date of the danger map). */
export const WMS_URL = 'https://cwfis.cfs.nrcan.gc.ca/geoserver/public/wms';

/** The version of the package (the release bumps it): the User-Agent follows. */
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return 'unknown';
  }
})();

/** Sent with every request: the server sees who asks. Never a browser's. */
export const USER_AGENT = `gladys-feux-canada/${VERSION} (+https://github.com/LM1LC3N7/gladys-feux-canada)`;

/** The layers read, their geometry column and the attributes asked for. */
export const LAYERS = {
  hotspots: {
    name: 'public:hotspots_last24hrs',
    geometry: 'geometry',
    properties: ['lat', 'lon', 'rep_date', 'sensor', 'satellite', 'agency'],
  },
  perimeters: {
    name: 'public:m3_polygons_current',
    geometry: 'geometry',
    properties: ['geometry', 'hcount', 'firstdate', 'lastdate', 'area'],
  },
  stations: {
    name: 'public:firewx_stns_current',
    geometry: 'the_geom',
    properties: ['aes', 'wmo', 'name', 'rep_date', 'prov', 'lat', 'lon', 'fwi'],
  },
  danger: {
    name: 'public:fdr_current_shp',
    geometry: 'the_geom',
    properties: ['the_geom', 'GRIDCODE'],
  },
};
/** The raster danger map whose legend title ends with the date of the map. */
export const DANGER_LEGEND_LAYER = 'public:fdr_current';

/** One request at a time, at least this long after the end of the previous one. */
export const REQUEST_SPACING = 1_000;
/** A request, headers and body, never takes longer. */
export const HTTP_TIMEOUT = 25_000;
/** Bytes read at most per answer: a larger one is cut and refused. */
export const MAX_BODY = {
  small: 256 * 1024,
  hotspots: 8 * 1024 * 1024,
  perimeters: 16 * 1024 * 1024,
  stations: 2 * 1024 * 1024,
  danger: 16 * 1024 * 1024,
};
/** Features asked at most (`count`); more matched is said in the status. */
export const MAX_FEATURES = { hotspots: 20_000, perimeters: 500, stations: 2_000, danger: 1_000 };
/** Vertices read at most in one answer of polygons (bounded analysis). */
export const MAX_VERTICES = 300_000;

/** Read interval (minutes): default, minimum and maximum. */
export const POLL = { default: 30, min: 15, max: 180 };
/** Search radius around a house (km): default, minimum and maximum. */
export const RADIUS = { default: 50, min: 5, max: 300 };
/** The fire weather stations are looked for this far (km), whatever the radius. */
export const STATION_SEARCH_KM = 200;
/** A station report older than this is not used (ms). */
export const STATION_MAX_AGE = 36 * 3600_000;
/** A perimeter is active when a hotspot touched it this recently (ms). */
export const PERIMETER_ACTIVE = 72 * 3600_000;
/** The newest hotspot of the whole layer older than this: the layer is stale (ms). */
export const HOTSPOTS_MAX_AGE = 18 * 3600_000;
/** The newest perimeter update of the whole layer older than this: stale (ms). */
export const PERIMETERS_MAX_AGE = 7 * 24 * 3600_000;
/** A danger map dated more than this many days before today (UTC) is stale. */
export const DANGER_MAX_DAYS = 2;
/** The danger polygons of a house are read again after this long (ms), or with a new map date. */
export const DANGER_REFRESH = 6 * 3600_000;
/**
 * The house is sent as its cell of this grid (degrees): every box is built
 * from the cell only, so crossing the requests tells nothing finer.
 */
export const BOX_GRID = 0.1;

/** 429/5xx: a pause, doubled at each one, between these bounds (ms). */
export const PAUSE = { min: 60_000, max: 6 * 3600_000 };
/** getConfig() failing in `connected`: retried, doubled, never given up. */
export const CONFIG_RETRY = { min: 5_000, max: 300_000 };
/** States re-sent unchanged after this long, so that a calm value stays dated. */
export const STATE_HEARTBEAT = 3 * 3600_000;
/** A reading kept in /data for the triggers is forgotten when older (ms). */
export const MEMORY_MAX_AGE = 48 * 3600_000;
/** Empty reads in a row before a "hotspot within" zone re-arms. */
export const REARM_READS = 2;
/** At most this many houses are watched. */
export const MAX_HOUSES = 5;
/** The danger class of the nearest polygon of the map within this distance (km) of the house. */
export const DANGER_NEAR_KM = 25;
/** Hotspots: up to this share of unreadable records, the readable ones are published as a minimum. */
export const MAX_UNREADABLE_SHARE = 0.1;
/** Nothing to read (no device, house gone): the houses are looked at again after this (ms). */
export const IDLE_RETRY = 60_000;
/** A write of /data is waited for at most this long (ms): a frozen /data holds nothing. */
export const SAVE_WAIT = 2_000;
/** A stop waits at most this long for the read running. */
export const STOP_WAIT = 3_000;

/** The danger classes of the map: GRIDCODE 0-4 published as 1-5. Forever. */
export const DANGER_CLASSES = ['low', 'moderate', 'high', 'very_high', 'extreme'];

/** The distances (km) of the "hotspot within" trigger. Forever (scene values). */
export const DISTANCES = [5, 10, 20, 30, 50, 100, 200, 300];

/** Languages of the feature texts. */
export const LANGUAGES = ['fr', 'en'];

/** Manifest keys (forever: stored in user scenes). */
export const ACTIONS = { TEST: 'test_connection' };
export const SCENE_TRIGGERS = { HOTSPOT: 'hotspot_nearby', DANGER: 'fire_danger_raised' };

/** Bounds of the texts published. */
export const LIMITS = { state: 200, status: 900 };
