# Canada wildfires (CWFIS, NRCan) for Gladys

**Unofficial** connector, not affiliated with Natural Resources Canada. It reads
the public layers of the **Canadian Wildland Fire Information System** (CWFIS,
`cwfis.cfs.nrcan.gc.ca`), no account, no key, and gives for each located house
of Gladys:

| Feature                   | What it is                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Satellite hotspots (24 h) | number of heat detections of the last 24 hours within the radius                                       |
| Nearest hotspot (km)      | its distance; with none within the radius, **the radius itself** ("none closer"), never 0              |
| Active fire perimeters    | estimated perimeters (M3 layer) touched by a hotspot in the last 72 h, within the radius (Canada only) |
| Nearest active perimeter  | distance to its outline, 0 when the house is inside; with none, the radius                             |
| Fire Weather Index (FWI)  | the FWI of the nearest fire weather station with a report under 36 h old, 200 km at most, rounded      |
| Fire weather station      | name, province, distance and time of the report of that station                                        |
| Fire danger               | class of the national map at the house: 1 low, 2 moderate, 3 high, 4 very high, 5 extreme (Canada)     |

And two scene triggers: **hotspot within a distance** and **fire danger
raised**.

**Hotspots are satellite heat detections, not confirmed fires**: a gas flare, a
factory, an agricultural burn give some too, and their time lags a few hours
behind the satellite pass. The layer covers North America; the perimeters and
the danger map cover Canada. This is information, not an alert nor an
evacuation system: follow the orders of your province and your municipality.

Never tested with a real device (there is none: it is a public service). The
module was tried against the real service on 2026-10-29 (Fredericton,
Kamloops, Portland) and its tests replay real answers of that day.

Contains information licensed under the Open Government Licence – Canada
(Natural Resources Canada, CWFIS).

## Installation

1. Install the integration from the Gladys store. It asks for the **location of
   the houses** (Settings > Houses): that is what puts the houses on the map.
2. Set the location of at least one house in Gladys.
3. Optional: change the **radius** (50 km by default, 5 to 300 km), the **read
   interval** (30 minutes by default, 15 to 180) and the **language** of the
   device names and directions.
4. Open **Discovery**: each located house is offered (5 at most). Create the
   device: the reads then start, at the next due time.

## What is read, and when

At each read, one request at a time, at least a second between two:

- the date of the newest hotspot of the whole layer, and of the last update of
  the perimeters: how fresh both layers are;
- the date of the danger map (legend of the map server);
- for each house with its device: the hotspots and perimeters in a box holding
  the radius, the stations within 200 km, and the danger map around the house
  (read again with a new map date, or after 6 hours).

Your exact location is not sent: the boxes are rounded outward to a tenth of a
degree, and the distances are computed in Gladys. The server offers neither
`ETag` nor `Last-Modified`: the interval is the only brake, and the next read
does not come sooner than the interval, neither after a restart (the time of the
last read is kept in `/data`), nor through the **Test** button, Discovery or
the creation of a device.

## No invented value

- Hotspot layer empty, or its newest hotspot over 18 h old: the source is
  silent or stale, the hotspots are **not published** (not 0 either) and the
  status says so.
- Perimeters not updated for 7 days (season over): not published. House off
  the danger map (outside Canada): neither perimeters nor danger.
- No station with a report under 36 h old and an FWI within 200 km: FWI and
  station not published (off season, November to March, this is the normal
  case).
- Danger map dated more than 2 days ago: danger not published. When its date is
  unreadable, the map is read anyway (an unknown date does not make it stale).
- A part that fails (HTTP error, answer too large, error report of the server)
  does not keep the others from being read and published.
- Unchanged values are sent again every 3 hours, so that they stay dated.

## Scene triggers

- **Hotspot within a distance** (5 to 300 km): a hotspot appears closer than
  the chosen distance where there was none at the previous read. Once per
  episode: it re-arms after two reads in a row without any hotspot at that
  distance. Beyond the radius of the configuration, the radius applies.
  Variables: distance (km), direction (N, NE...), bearing, count, time of the
  detection, satellite.
- **Fire danger raised**: the class reaches the chosen level (moderate, high,
  very high, extreme) coming from below it; a jump from low to high fires
  "moderate" and "high". Variables: current level and its name, previous level,
  FWI of the station, date of the map.

Nothing fires at the first read of a house (no known value before). The memory
of the triggers is kept in `/data` for 48 hours, so that a restart sees a rise
that happened meanwhile.

## Status

The status of the configuration page gives the time of the last read, what was
read for each house, what was not and why (stale layer, off season, outside
Canada, error), and recalls that hotspots are not confirmed fires. A server
asking to wait (HTTP 429 or 5xx) pauses the reads from 1 minute to 6 hours
(doubled each time, or its `Retry-After` when longer), a pause kept in `/data`.
Server unreachable: new try at the next interval.

The **Test** button reads at once when a read is due, else it shows the last
one and the time of the next. Without any device created, it makes one small
request (the freshness of the hotspots), counted as the read.

## Troubleshooting

- **"No located house"**: set the location of a house in Gladys (Settings >
  Houses), then run Discovery again.
- **"The houses of Gladys could not be read"**: the integration was refused
  the location; new try every minute, without any request to the CWFIS.
- **No FWI in winter**: normal, the fire weather stations publish during the
  fire season only.

## Data and licence

Source: Natural Resources Canada, Canadian Wildland Fire Information System
(<https://cwfis.cfs.nrcan.gc.ca/>), WFS layers `hotspots_last24hrs`,
`m3_polygons_current`, `firewx_stns_current`, `fdr_current_shp`. Open
Government Licence – Canada
(<https://open.canada.ca/en/open-government-licence-canada>). The integration
introduces itself to the server under its own name (`User-Agent:
gladys-feux-canada/0.1.0`), never as a browser.
