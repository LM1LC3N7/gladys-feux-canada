# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- One device per located house of Gladys: satellite hotspots of the last 24 h
  within a radius and the nearest one, active fire perimeters (Canada) and the
  nearest one, the Fire Weather Index of the nearest fire weather station, and
  the fire danger class of the national map (Canada), read from the public WFS
  of the CWFIS (Natural Resources Canada, Open Government Licence - Canada).
- Scene triggers "hotspot within a distance" and "fire danger raised".
- A stale, silent or out-of-season layer is said in the status, never published
  as 0; the exact location of the house is never sent (boxes rounded to a tenth
  of a degree).
- One request at a time, a read never sooner than the interval (restart, test
  button and Discovery included), a pause kept in `/data` after a 429 or 5xx.
- Without any device created, nothing is sent and the houses are looked at
  again once a minute; a frozen or unwritable `/data` never holds the reads nor
  the stop, and is said in the status.
- Unreadable or cut answers are never published as a count; a US house near
  the border is not counted as on the Canadian map.
- "In Canada" is decided on a bundled outline of Canada and the United States
  (Natural Earth, public domain): Canadian cities and shores get their
  perimeters and the danger class of the nearest area of the map (within
  25 km), US houses by the border get neither; a few unreadable hotspot
  records, or a cut answer, publish the hotspots as a minimum.
