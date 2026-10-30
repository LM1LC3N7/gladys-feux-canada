# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
ports no third-party code: it was written from the public answers and the
schemas (`DescribeFeatureType`) of the GeoServer of the CWFIS. It reads the data
and runs with the library below, each under its own licence.

## Canadian Wildland Fire Information System (CWFIS) data

Natural Resources Canada, Canadian Forest Service, Canadian Wildland Fire
Information System, <https://cwfis.cfs.nrcan.gc.ca/>: the WFS layers
`public:hotspots_last24hrs`, `public:m3_polygons_current`,
`public:firewx_stns_current` and `public:fdr_current_shp`, and the legend of the
WMS layer `public:fdr_current`. Open Government Licence - Canada,
<https://open.canada.ca/en/open-government-licence-canada>.

Contains information licensed under the Open Government Licence – Canada.

The integration neither copies nor redistributes the data: it reads it for the
user's own Gladys. The test fixtures in `test/fixtures/` are answers of the
service captured on 2026-10-29 (public data, no personal information), kept
under the same licence and attribution. The danger polygons around Toronto,
Montréal, Whitehorse and Iqaluit (`test/fixtures/danger-*.json`) are simplified
(0.001 to 0.01 degree) to keep the fixtures small.

## Natural Earth (outlines of Canada and of the United States)

`src/outline.json` is derived from Natural Earth 1:10m Cultural Vectors,
Admin 0 Countries, version 5.1.2 (<https://www.naturalearthdata.com/>,
<https://github.com/nvkelso/natural-earth-vector>): the polygons of Canada and
of the United States, simplified by `scripts/outline.mjs` (217 KB). Natural
Earth is in the public domain ("No permission is needed to use Natural
Earth"). Used only to tell whether a house is in Canada.

## @gladysassistant/integration-sdk

<https://github.com/GladysAssistant/integration-sdk-js>, the SDK of the Gladys
external integrations (runtime dependency). Apache License 2.0.

## gladys-testkit (tests only)

`test/kit/clock.mjs` is copied from `gladys-testkit` (same author, Apache
License 2.0): the virtual and real clocks of the tests. Not in the image.
