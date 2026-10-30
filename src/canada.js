// -----------------------------------------------------------------------------
// Is a house in Canada? The perimeters and the danger map cover Canada only:
// a house across the border must get nothing, not a false 0. Decided locally
// on the outlines of Canada and of the United States (Natural Earth 1:10m,
// public domain, simplified: src/outline.json, built by
// scripts/outline.mjs), never by asking a server. Pure.
//
//   inside one outline only     that country
//   inside both (simplified)    the one the house is deeper in
//   inside none (a shore, an    Canada when its outline is within COAST_KM and
//   island, a river)            nearer than the United States one
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { containsPoint } from './geo.js';

/** A house this close (km) to the Canadian outline, in none, is on a Canadian shore. */
export const COAST_KM = 10;

const load = () => {
  const data = JSON.parse(readFileSync(new URL('./outline.json', import.meta.url), 'utf8'));
  return { canada: prepare(data.canada), usa: prepare(data.usa) };
};

/** Each polygon with its box (degrees), to skip the far ones quickly. */
function prepare(multiPolygon) {
  return multiPolygon.map((rings) => {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const [x, y] of rings[0]) {
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
    return { geometry: { type: 'Polygon', coordinates: rings }, west, south, east, north };
  });
}

let outlines;
const get = () => (outlines ??= load());

/** About `km` in degrees of latitude, and of longitude at the latitude. */
const margin = (point, km) => ({
  lat: km / 111.2,
  lon: km / (111.2 * Math.max(0.05, Math.cos((point.latitude * Math.PI) / 180))),
});

/** Inside one of the polygons. */
function inside(polygons, point) {
  return polygons.some(
    (p) =>
      point.longitude >= p.west &&
      point.longitude <= p.east &&
      point.latitude >= p.south &&
      point.latitude <= p.north &&
      containsPoint(p.geometry, point),
  );
}

/** Distance (km) to the nearest outline of the polygons within `km`; Infinity beyond. */
function distanceTo(polygons, point, km) {
  const m = margin(point, km);
  let best = Infinity;
  for (const p of polygons) {
    if (
      point.longitude < p.west - m.lon ||
      point.longitude > p.east + m.lon ||
      point.latitude < p.south - m.lat ||
      point.latitude > p.north + m.lat
    ) {
      continue;
    }
    // Distance to the outline itself, inside or not.
    best = Math.min(best, outlineDistance(p.geometry.coordinates, point));
  }
  return best;
}

/** Distance (km) from the point to the nearest edge of the rings (a local flat projection). */
function outlineDistance(rings, point) {
  const cos = Math.cos((point.latitude * Math.PI) / 180);
  const xy = ([lon, lat]) => [
    (lon - point.longitude) * cos * 111.2,
    (lat - point.latitude) * 111.2,
  ];
  let best = Infinity;
  for (const ring of rings) {
    let a = xy(ring[ring.length - 1]);
    for (const vertex of ring) {
      const b = xy(vertex);
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / l2));
      best = Math.min(best, Math.hypot(a[0] + t * dx, a[1] + t * dy));
      a = b;
    }
  }
  return best;
}

/**
 * The 49th parallel is the border from Boundary Bay to the Lake of the Woods:
 * there it is exact (the simplified outline is about 1 km off at Blaine).
 */
const PARALLEL = { west: -122.76, east: -95.16, lat: 49, band: 0.2 };
/** Elsewhere a house this close (km) to the other country's outline is in doubt. */
export const BORDER_DOUBT_KM = 1;
/** On a shore (in none of the outlines), both countries this close (km): in doubt. */
export const SHORE_DOUBT_KM = 2;

/**
 * Where the house is: 'canada' (or a Canadian shore), 'usa', 'doubt' (within
 * BORDER_DOUBT_KM of the border, the outline cannot tell) or 'elsewhere'.
 */
export function countryOf(point) {
  const { canada, usa } = get();
  if (
    point.longitude > PARALLEL.west &&
    point.longitude < PARALLEL.east &&
    Math.abs(point.latitude - PARALLEL.lat) < PARALLEL.band
  ) {
    return point.latitude >= PARALLEL.lat ? 'canada' : 'usa';
  }
  const inCa = inside(canada, point);
  const inUs = inside(usa, point);
  let country;
  if (inCa !== inUs) {
    country = inCa ? 'canada' : 'usa';
  } else if (inCa && inUs) {
    // Both simplified outlines hold it: the country it is deeper in.
    country = distanceTo(canada, point, 50) >= distanceTo(usa, point, 50) ? 'canada' : 'usa';
  } else {
    const dCa = distanceTo(canada, point, COAST_KM);
    const dUs = distanceTo(usa, point, COAST_KM);
    if (dCa > COAST_KM && dUs > COAST_KM) return 'elsewhere';
    // A strait between the two (Lubec and Campobello): too close to tell.
    if (dCa <= SHORE_DOUBT_KM && dUs <= SHORE_DOUBT_KM) return 'doubt';
    country = dCa < dUs ? 'canada' : 'usa';
  }
  const other = country === 'canada' ? usa : canada;
  return distanceTo(other, point, BORDER_DOUBT_KM) <= BORDER_DOUBT_KM ? 'doubt' : country;
}

/** True when the house is in Canada (or on a Canadian shore), and not in doubt. */
export function inCanada(point) {
  return countryOf(point) === 'canada';
}
