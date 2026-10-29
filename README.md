# gladys-feux-canada

Wildfires near your home in Canada for [Gladys Assistant](https://gladysassistant.com):
an external integration that reads the public layers of the **Canadian Wildland
Fire Information System** (CWFIS, Natural Resources Canada) and gives, for each
located house of Gladys, the satellite hotspots of the last 24 hours within a
radius and the nearest one, the active fire perimeters (Canada), the Fire
Weather Index (FWI) of the nearest fire weather station and the fire danger
class of the national map (Canada), with the scene triggers "hotspot within a
distance" and "fire danger raised".

**Unofficial**, not affiliated with Natural Resources Canada. Hotspots are
satellite heat detections, not confirmed fires. Information only, never an
evacuation or safety system. Never tested with a real device (there is none: a
public service); tried against the real service on 2026-10-29.

Contains information licensed under the Open Government Licence – Canada.

- Guide: [français](docs/fr.md) · [English](docs/en.md)
- No account, no key; the exact location of a house never leaves Gladys (boxes
  rounded to a tenth of a degree).
- One request at a time, every 30 minutes by default; a stale, silent or
  out-of-season layer is said in the status, never published as 0.

## Development

```bash
npm install
npm test             # node --test, fake CWFIS (real captures) and fake Gladys
npm run lint
npm run format:check
npm run cover        # regenerate cover.png
```

See [`CLAUDE.md`](CLAUDE.md) for the architecture and the rules,
[`TODO.md`](TODO.md) for the decisions, [`CHANGELOG.md`](CHANGELOG.md).

## Licence

Apache License 2.0 (see [`LICENSE`](LICENSE)); the data and the library used are
listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
