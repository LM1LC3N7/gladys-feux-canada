// -----------------------------------------------------------------------------
// What was read around one house -> its reading. Pure. Each part (hotspots,
// perimeters, station, danger) carries its own status: only an 'ok' part is
// published, a stale, silent or failed one is said in the status and never
// published as 0.
// -----------------------------------------------------------------------------

import { DANGER_MAX_DAYS, DISTANCES, STATION_MAX_AGE } from './constants.js';
import { bearingDeg, distanceKm, distanceToPolygonKm } from './geo.js';

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * The hotspots within the radius: count, nearest (km, bearing, time), the
 * newest time, and the count within each distance of the trigger (a distance
 * larger than the radius counts what the radius holds).
 */
export function hotspotsPart(house, items, radiusKm, { truncated = false, unreadable = 0 } = {}) {
  const near = [];
  for (const h of items) {
    const km = distanceKm(house, h);
    if (km <= radiusKm) {
      near.push({ ...h, km });
    }
  }
  near.sort((a, b) => a.km - b.km || b.at - a.at);
  const zones = {};
  for (const d of DISTANCES) {
    const within = near.filter((h) => h.km <= Math.min(d, radiusKm));
    zones[d] = {
      count: within.length,
      nearest: within[0]
        ? {
            km: round1(within[0].km),
            bearing: bearingDeg(house, within[0]),
            at: within[0].at,
            satellite: within[0].satellite,
          }
        : null,
    };
  }
  const nearest = near[0];
  return {
    status: 'ok',
    count: near.length,
    truncated,
    unreadable,
    // Records missing (cut answer, unreadable ones): the count is a minimum and
    // the nearest may be farther than the true one (not published). See
    // hotspotCount: "at least 0" is no count.
    incomplete: truncated || unreadable > 0,
    nearestKm: nearest ? round1(nearest.km) : null,
    bearing: nearest ? bearingDeg(house, nearest) : null,
    nearestAt: nearest ? nearest.at : null,
    newestAt: near.length > 0 ? Math.max(...near.map((h) => h.at)) : null,
    zones,
  };
}

/**
 * The hotspot count that may be published, or undefined. Records missing (a
 * cut answer, unreadable ones): the readable hotspots within the radius are a
 * true minimum when there is at least one; with none, the count is unknown
 * (an unreadable record may be 1 km away), never a 0.
 */
export function hotspotCount(part) {
  if (part?.status !== 'ok') return undefined;
  if (part.incomplete && part.count === 0) return undefined;
  return part.count;
}

/** The active perimeters within the radius: count, nearest distance (0 inside one). */
export function perimetersPart(house, items, radiusKm, { truncated = false } = {}) {
  const near = [];
  for (const p of items) {
    const km = distanceToPolygonKm(p.geometry, house);
    if (km !== undefined && km <= radiusKm) {
      near.push({ ...p, km });
    }
  }
  near.sort((a, b) => a.km - b.km);
  return {
    status: 'ok',
    count: near.length,
    truncated,
    nearestKm: near[0] ? round1(near[0].km) : null,
    inside: near.some((p) => p.km === 0),
    nearestLastAt: near[0] ? near[0].lastAt : null,
  };
}

/**
 * The nearest station whose report is fresh and carries an FWI, within the
 * search distance; `{ status: 'none' }` when there is none (off season, or
 * no station near).
 */
export function stationPart(house, stations, now, searchKm) {
  const fresh = stations
    .filter((s) => s.fwi !== undefined && now - s.at <= STATION_MAX_AGE && s.at <= now + 3600_000)
    .map((s) => ({ ...s, km: distanceKm(house, s) }))
    .filter((s) => s.km <= searchKm)
    .sort((a, b) => a.km - b.km);
  const best = fresh[0];
  if (!best) {
    return { status: 'none', seen: stations.length };
  }
  return {
    status: 'ok',
    id: best.id,
    name: best.name,
    province: best.province,
    km: round1(best.km),
    at: best.at,
    fwi: best.fwi,
  };
}

/** Days between the map date ("YYYY-MM-DD") and the UTC day of `now`. */
export function mapAgeDays(date, now) {
  const at = Date.parse(`${date}T00:00:00Z`);
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  return Math.round((today - at) / 86_400_000);
}

/**
 * The danger class at the house: `found` is `{ code, km }`, the polygon of the
 * map holding the house (km 0) or the nearest within DANGER_NEAR_KM (GRIDCODE
 * 0-4 published as level 1-5), undefined when none is that near (the far
 * North). `date` is the date of the map when readable: older than
 * DANGER_MAX_DAYS it is stale; unreadable, it is never called stale.
 */
export function dangerPart(found, { date, now }) {
  if (date !== undefined && mapAgeDays(date, now) > DANGER_MAX_DAYS) {
    return { status: 'stale', date };
  }
  if (!found) {
    return { status: 'none', date };
  }
  return { status: 'ok', level: found.code + 1, km: found.km, date };
}
