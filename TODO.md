# TODO

## Decisions

- Version 0.1.0 set by hand (package.json, lock, manifest, `docker_image`
  `ghcr.io/lm1lc3n7/gladys-feux-canada:0.1.0`), SDK `^0.16.0` (latest published
  on 2026-10-29).
- No `keywords` nor `countries` in the manifest (the store rule): Canada and the
  northern US would fit `countries` when the store allows it.
- One category: `environment` (open-data daily-life feed, weather and fire).
- No reference library exists: the requests are written from the GeoServer
  answers and schemas. GeoJSON in `EPSG:4326` (the layers are stored in a
  Lambert projection); CQL `BBOX(...,'EPSG:4326')` takes longitude/latitude
  (checked on the live server: the `urn:` form swaps the axes).
- The houses come from Gladys (`location: true`), 5 at most; the exact
  position never leaves Gladys: every box (radius, 200 km stations, danger
  map) is built from the 0.1° cell of the house only (r1 m9: three boxes of
  different widths crossed to ~13 % of the cell); the danger polygon holding
  the house is found locally. Across the date line the box spans every
  longitude (r1 m1).
- r2 I1: "in Canada" (perimeters and danger read) is decided on a bundled
  outline of Canada and the US (Natural Earth 1:10m, public domain, built by
  `scripts/outline.mjs`: 0.003 degree within ~30 km of the other country, 0.06
  elsewhere, 217 KB): one outline holds the house -> that country; both
  (simplified overlap) -> the deeper; none -> the nearest outline within 10 km
  (a shore); within 1 km of the other country (2 km on a strait), 'doubt':
  nothing published. The 49th parallel (Boundary Bay to the Lake of the Woods)
  is exact: the 1:10m line is ~1 km off at Blaine. Checked on 82 Canadian and 26
  US places (the reviewer's list and mine): none misclassified, border-river
  towns in doubt (Calais/St Stephen, Lubec, Stanstead, Sarnia/Port Huron,
  Detroit, Sault Ste Marie, Fort Frances/International Falls, Hyder, Point
  Roberts). Danger: the polygon holding the house, else the nearest within 25
  km (polygons asked in the cell box widened by 25 km); none -> said (far
  North). Superseded below: the r1 rule "inside a danger polygon" left out ~1
  Canadian house in 5 and took Calais and Lubec.
- r1 (superseded): "On the Canadian map": the house is inside a
  danger polygon, nothing else (r1 I1: the old "a polygon in the box" took US
  houses up to ~16 km south of the border, with a false 0 perimeter). Checked
  on the real map (2026-10-29): it stops at 49 N (inside at 49.05, outside at
  48.99, at four longitudes); a 1 km tolerance still took a house 200 m south
  of the border at Sumas. A house in a gap of the map (a lake) loses its
  perimeters too: nothing rather than a false 0.
- An unreadable record (geometry without outline included, r2 m1) or an
  answer cut at its page size fails the perimeter and danger parts; hotspots
  (r2 m2): up to a tenth unreadable, or cut at 20,000, the readable ones are
  published as a minimum ("at least N"), the nearest not published (it may be
  farther). The r1 rule ("never a partial count") silenced the feed at the
  worst fire (r1 I2, m5, m6). The real layers had no unreadable
  record on 2026-10-29 (2012 stations, 2251 hotspots, 736 perimeters).
- No device, or a device without its house: no request to the CWFIS, the
  houses looked at again every minute (r1 B1); any way out of a read leaves
  the next try at least a minute away.
- /data: a write is waited for 2 s at most (start, read, stop); frozen,
  unwritable or unreadable is said in the status (r1 I3, m7).
- A configuration saved during a read drops it; the next read comes at the
  interval (r1 m3, accepted and documented).
- The User-Agent version is read from package.json (r1 m8).
- Without any hotspot (or perimeter) within the radius, the distance published
  is the radius ("none closer"), as gladys-blitzortung; never 0.
- Freshness: newest hotspot of the whole layer over 18 h, perimeters without an
  update for 7 days, a station report over 36 h, a danger map dated more than
  2 days ago: not published, said in the status.
- Perimeters (M3) and the danger map cover Canada only: a house off the danger
  map gets neither (0 perimeters would be false in the US).
- "Active perimeter": a hotspot touched it in the last 72 h (the layer keeps
  the whole season); the area (`area`, unit not documented) is not published.
- The danger class GRIDCODE 0-4 (legend of the server: Low..Extreme) is
  published as 1-5, so that 0 never means anything.
- FWI published rounded (risk/integer: the core has no decimal index category).
- The station is identified by its AES number (the feature id changes at each
  request); its name comes with '+' for spaces, written back as spaces.
- The server sends neither ETag nor Last-Modified: no conditional request.
- The test button reads only when a read is due; without device, one small
  request, counted as the read.

## Later

- A dashboard widget (map of the hotspots around the house, nearest fires).
- The danger forecast of the next days (NAEFS / SCRIBE layers `fdr_*`).
- `countries` when the store takes it.
