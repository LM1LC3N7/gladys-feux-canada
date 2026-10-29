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
under the same licence and attribution.

## @gladysassistant/integration-sdk

<https://github.com/GladysAssistant/integration-sdk-js>, the SDK of the Gladys
external integrations (runtime dependency). Apache License 2.0.

## gladys-testkit (tests only)

`test/kit/clock.mjs` is copied from `gladys-testkit` (same author, Apache
License 2.0): the virtual and real clocks of the tests. Not in the image.
