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
  position never leaves Gladys: boxes rounded outward to 0.1°, the danger
  polygon holding the house found locally.
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
