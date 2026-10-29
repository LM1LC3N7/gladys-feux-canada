# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.16), its only
runtime dependency. It reads the public WFS of the **CWFIS** (Canadian Wildland
Fire Information System, Natural Resources Canada, no key, Open Government
Licence - Canada) and turns it into one read-only device per located house of
Gladys (`location: true`): satellite hotspots of the last 24 h, active fire
perimeters, the FWI of the nearest station and the fire danger class, plus two
scene triggers. Unofficial. Hotspots are heat detections, not confirmed fires.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/devices.test.js          # one file
node --test --test-name-pattern "plug"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js              SDK wiring only (handlers registered before connect())
src/app.js            FeuxApp: lifecycle (getConfig retried), houses, Discovery,
                      the read loop (one timer, monotonic), parts, pause, status,
                      test button
src/cwfis.js          the GeoServer client: URLs, one request at a time and
                      spaced, strict reading of the features
src/http.js           the only network access (timeout, User-Agent, byte budget)
src/geo.js            distance, bearing, boxes rounded outward, point in polygon
src/model.js          raw features -> parts of a reading (pure)
src/devices.js        devices, feature keys, states (pure)
src/triggers.js       readings -> scene events, the memory kept in /data (pure)
src/store.js          /data (time of the last read, pause, trigger memory)
src/config.js         config_schema normalized
src/constants.js      endpoints, layers, limits, freshness, manifest keys
src/i18n.js           feature names, danger classes, status texts (en/fr)
test/fixtures/        real answers of the service (2026-10-29)
test/helpers/app.js   fake CWFIS (fixtures by layer), virtual clock, fake Gladys
test/kit/clock.mjs    clocks of gladys-testkit (virtual and real)
scripts/cover.mjs     cover.png (800x534), plain Node
```

## Known facts of the source (2026-10-29)

- GeoServer, WFS 2.0.0, `outputFormat=application/json`, `srsName=EPSG:4326`.
  CQL `BBOX(geom,west,south,east,north,'EPSG:4326')` is longitude first. An
  error is an XML `ExceptionReport` with status 200.
- `hotspots_last24hrs`: North America, `lat`/`lon`/`rep_date`, stable ids,
  newest a few hours behind. `m3_polygons_current`: Canada, the whole season,
  `lastdate` of the last hotspot. `firewx_stns_current`: ids change at each
  request (use `aes`), names padded and with '+' for spaces, no report out of
  season. `fdr_current_shp`: Canada, `GRIDCODE` 0-4 = Low..Extreme, no date
  (the WMS legend of `fdr_current` ends with it).
- No ETag, no Last-Modified, no documented rate limit: one request at a time,
  a second apart, every 30 minutes by default.

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Never publish an unknown as 0**: a stale, silent, failed or uncovered part
  is not published and is said in the status.
- **Never read sooner than the interval** (restart, Discovery, test button).
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
