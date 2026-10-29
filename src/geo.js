// -----------------------------------------------------------------------------
// Geometry on the sphere: distance, bearing, compass point, the box sent to
// the server (snapped outward to a coarse grid, so the exact house never
// leaves Gladys), and the distance from a point to a (multi)polygon given in
// GeoJSON longitude/latitude. Pure.
// -----------------------------------------------------------------------------

import { BOX_GRID } from './constants.js';

const EARTH_KM = 6371;
const KM_PER_DEGREE = (Math.PI * EARTH_KM) / 180; // ~111.2 km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Great-circle distance in km between { latitude, longitude } points. */
export function distanceKm(a, b) {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north (0-359). */
export function bearingDeg(a, b) {
  const phi1 = rad(a.latitude);
  const phi2 = rad(b.latitude);
  const dLambda = rad(b.longitude - a.longitude);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (Math.round(deg(Math.atan2(y, x))) + 360) % 360;
}

const POINTS = {
  en: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
  fr: ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'],
};

/** The 8-point compass name of a bearing: 0 -> N, 45 -> NE, 270 -> W (O). */
export function compassPoint(bearing, language = 'en') {
  const points = POINTS[language] ?? POINTS.en;
  return points[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
}

const snapDown = (v) => Math.floor(v / BOX_GRID + 1e-9) * BOX_GRID;
const snapUp = (v) => Math.ceil(v / BOX_GRID - 1e-9) * BOX_GRID;
const fixed = (v) => Number(v.toFixed(4));

/**
 * The longitude/latitude box holding every point within `km` of `point`,
 * snapped OUTWARD to the BOX_GRID: what is sent to the server says where the
 * house is only to a tenth of a degree. Near a pole the box spans every
 * longitude. `{ west, south, east, north }`.
 */
export function boundingBox(point, km) {
  const dLat = km / KM_PER_DEGREE;
  const south = Math.max(-90, point.latitude - dLat);
  const north = Math.min(90, point.latitude + dLat);
  const widest = Math.max(Math.abs(south), Math.abs(north));
  const cos = Math.cos(rad(Math.min(89.9, widest)));
  const dLon = km / (KM_PER_DEGREE * cos);
  const whole = widest >= 89.9 || dLon >= 180;
  return {
    west: whole ? -180 : fixed(Math.max(-180, snapDown(point.longitude - dLon))),
    south: fixed(Math.max(-90, snapDown(south))),
    east: whole ? 180 : fixed(Math.min(180, snapUp(point.longitude + dLon))),
    north: fixed(Math.min(90, snapUp(north))),
  };
}

/** A box of `degrees` each side of the point, snapped outward like boundingBox. */
export function degreeBox(point, degrees) {
  return {
    west: fixed(Math.max(-180, snapDown(point.longitude - degrees))),
    south: fixed(Math.max(-90, snapDown(point.latitude - degrees))),
    east: fixed(Math.min(180, snapUp(point.longitude + degrees))),
    north: fixed(Math.min(90, snapUp(point.latitude + degrees))),
  };
}

const finitePair = (p) =>
  Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && p.length >= 2;

/** The rings of a GeoJSON Polygon or MultiPolygon, each a list of [lon, lat]; [] otherwise. */
export function ringsOf(geometry) {
  if (!geometry || typeof geometry !== 'object') {
    return [];
  }
  const polygons =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  const rings = [];
  for (const polygon of Array.isArray(polygons) ? polygons : []) {
    for (const ring of Array.isArray(polygon) ? polygon : []) {
      if (Array.isArray(ring) && ring.length >= 3 && ring.every(finitePair)) {
        rings.push(ring);
      }
    }
  }
  return rings;
}

/** Number of vertices of a geometry (bounded analysis). */
export function vertexCount(geometry) {
  return ringsOf(geometry).reduce((n, ring) => n + ring.length, 0);
}

/**
 * Is the point inside the (multi)polygon? Even-odd over every ring, so a
 * hole of a polygon is outside. `point` is { latitude, longitude }.
 */
export function containsPoint(geometry, point) {
  const x = point.longitude;
  const y = point.latitude;
  let inside = false;
  for (const ring of ringsOf(geometry)) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Distance (km) from the point to the outline of the (multi)polygon: 0 when
 * the point is inside. On a local flat projection around the point (exact
 * enough within a few hundred km of a house, away from the poles).
 * `undefined` without a ring.
 */
export function distanceToPolygonKm(geometry, point) {
  const rings = ringsOf(geometry);
  if (rings.length === 0) {
    return undefined;
  }
  if (containsPoint(geometry, point)) {
    return 0;
  }
  const cos = Math.cos(rad(point.latitude));
  const toXY = ([lon, lat]) => {
    let dLon = lon - point.longitude;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    return [dLon * cos * KM_PER_DEGREE, (lat - point.latitude) * KM_PER_DEGREE];
  };
  let best = Infinity;
  for (const ring of rings) {
    let previous = toXY(ring[ring.length - 1]);
    for (const vertex of ring) {
      const current = toXY(vertex);
      const [ax, ay] = previous;
      const [bx, by] = current;
      const dx = bx - ax;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2));
      const px = ax + t * dx;
      const py = ay + t * dy;
      best = Math.min(best, Math.hypot(px, py));
      previous = current;
    }
  }
  return best;
}
