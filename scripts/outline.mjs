// Builds src/outline.json: the outlines of Canada and of the United States
// from Natural Earth 1:10m Admin 0 Countries (public domain), simplified
// (Douglas-Peucker) and rounded to 4 decimals, so that the module can tell a
// house in Canada from one across the border without asking anybody. Fine
// (0.003 degree, about 300 m) where the two countries meet (south of 49.6 N,
// and along Alaska), coarse (0.06 degree) elsewhere: there the module allows
// 10 km of coast anyway, and the United States far from Canada (south of
// 40 N, Hawaii) are left out. Usage:
//   node scripts/outline.mjs <ne_10m_admin_0_countries.geojson> src/outline.json
import { readFileSync, writeFileSync } from 'node:fs';

const [source, target = 'src/outline.json'] = process.argv.slice(2);
const FINE = 0.003;
const COARSE = 0.06;
/** The vertices of each country on a grid of 0.25 degree: "near the other one" is a lookup. */
const CELL = 0.25;
const key = (x, y) => `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
const gridOf = (geometry) => {
  const grid = new Set();
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons)
    for (const ring of polygon) for (const [x, y] of ring) grid.add(key(x, y));
  return grid;
};
const nearTo =
  (grid) =>
  ([x, y]) => {
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (grid.has(key(x + dx * CELL, y + dy * CELL))) return true;
      }
    }
    return false;
  };
let near = () => true;
const tolerance = (p) => (near(p) ? FINE : COARSE);
const all = JSON.parse(readFileSync(source, 'utf8'));
const country = (code) => all.features.find((f) => f.properties.ADM0_A3 === code);

const sqSegDist = ([x, y], [x1, y1], [x2, y2]) => {
  let dx = x2 - x1;
  let dy = y2 - y1;
  if (dx !== 0 || dy !== 0) {
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    x1 += dx * t;
    y1 += dy * t;
  }
  dx = x - x1;
  dy = y - y1;
  return dx * dx + dy * dy;
};
const simplify = (points) => {
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let max = 0;
    let index = 0;
    for (let i = first + 1; i < last; i += 1) {
      const d = sqSegDist(points[i], points[first], points[last]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > tolerance(points[index]) ** 2) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
};
const round = (v) => Math.round(v * 1e4) / 1e4;
const shrink = (geometry, keepPolygon = () => true) => {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const out = [];
  for (const polygon of polygons.filter(keepPolygon)) {
    const rings = polygon
      .map((ring) => simplify(ring).map(([x, y]) => [round(x), round(y)]))
      .filter((ring) => ring.length >= 4);
    if (rings.length > 0) out.push(rings);
  }
  return out;
};
const nearUsa = nearTo(gridOf(country('USA').geometry));
const nearCanada = nearTo(gridOf(country('CAN').geometry));
near = nearUsa;
const canada = shrink(country('CAN').geometry);
near = nearCanada;
// Only the parts of the United States that reach north of 40 N (the mainland, Alaska).
const usa = shrink(country('USA').geometry, (polygon) => polygon[0].some(([, y]) => y > 40));
const data = {
  source:
    'Natural Earth 1:10m Admin 0 Countries v5.1.2 (public domain), simplified 0.003 degree within about 30 km of the other country, 0.06 elsewhere',
  canada,
  usa,
};
writeFileSync(target, JSON.stringify(data));
const count = (mp) => mp.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0);
console.log(
  target,
  JSON.stringify(data).length,
  'bytes',
  count(data.canada),
  'vertices (Canada)',
  count(data.usa),
  '(USA)',
);
