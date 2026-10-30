// -----------------------------------------------------------------------------
// The Gladys devices and their states. Pure.
//
// External ids (forever):
//   house:<houseSelector>                  one located house of Gladys
//   house:<houseSelector>:<feature key>    its features
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { LIMITS, MAX_FEATURES, RADIUS } from './constants.js';
import { FEATURE_NAMES } from './i18n.js';

/** Feature keys (forever). */
export const FEATURE = {
  HOTSPOTS: 'hotspots',
  NEAREST_HOTSPOT: 'nearest_hotspot_km',
  PERIMETERS: 'active_perimeters',
  NEAREST_PERIMETER: 'nearest_perimeter_km',
  FWI: 'fwi',
  DANGER: 'danger',
  STATION: 'station',
};

export const ids = {
  house: (gladys, selector) => gladys.externalId(`house:${selector}`),
  feature: (deviceId, key) => `${deviceId}:${key}`,
};

/** A house selector as Gladys makes them: lowercase letters, digits and dashes. */
export const validSelector = (s) => typeof s === 'string' && /^[a-z0-9][a-z0-9_-]{0,99}$/.test(s);

/** The house selector of one of our devices, or undefined for any other id. */
export function parseExternalId(externalId) {
  const match = /^ext:[^:]+:house:([^:]+)$/.exec(String(externalId ?? ''));
  return match && validSelector(match[1]) ? { selector: match[1] } : undefined;
}

const feature = (deviceId, key, name, category, type, extra = {}) => ({
  name,
  external_id: ids.feature(deviceId, key),
  category,
  type,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});

/** The device of one located house (`house` is a getHouses() entry). */
export function buildHouseDevice(gladys, house, language = 'fr') {
  const id = ids.house(gladys, house.selector);
  const name = (key) => FEATURE_NAMES[key][language] ?? FEATURE_NAMES[key].en;
  const distance = { unit: U.KM, min: 0, max: RADIUS.max };
  return {
    name: `${language === 'fr' ? 'Feux près de' : 'Wildfires near'} ${house.name}`,
    external_id: id,
    features: [
      feature(id, FEATURE.HOTSPOTS, name('hotspots'), C.COUNTER_SENSOR, T.SENSOR.INTEGER, {
        min: 0,
        max: MAX_FEATURES.hotspots,
      }),
      feature(
        id,
        FEATURE.NEAREST_HOTSPOT,
        name('nearestHotspot'),
        C.DISTANCE_SENSOR,
        T.SENSOR.DECIMAL,
        distance,
      ),
      feature(id, FEATURE.PERIMETERS, name('perimeters'), C.COUNTER_SENSOR, T.SENSOR.INTEGER, {
        min: 0,
        max: MAX_FEATURES.perimeters,
      }),
      feature(
        id,
        FEATURE.NEAREST_PERIMETER,
        name('nearestPerimeter'),
        C.DISTANCE_SENSOR,
        T.SENSOR.DECIMAL,
        distance,
      ),
      feature(id, FEATURE.FWI, name('fwi'), C.RISK, T.RISK.INTEGER, { min: 0, max: 200 }),
      feature(id, FEATURE.DANGER, name('danger'), C.RISK, T.RISK.INTEGER, { min: 1, max: 5 }),
      feature(id, FEATURE.STATION, name('station'), C.TEXT, T.TEXT.TEXT, {
        min: 0,
        max: 0,
        keep_history: false,
      }),
    ],
    params: [{ name: 'house', value: house.selector }],
  };
}

const cut = (s, max) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const utc = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** The text of the station feature: name, province, distance, time of the report. */
export function stationText(station) {
  const where = station.province ? `${station.name} (${station.province})` : station.name;
  return cut(`${where}, ${station.km} km, ${utc(station.at)}`, LIMITS.state);
}

/**
 * The states of a reading: only its parts read fresh. With no hotspot (or no
 * active perimeter) within the radius, the distance is the radius itself:
 * "none closer than this", never 0.
 */
export function houseStates(deviceId, reading, radiusKm) {
  const states = [];
  const put = (key, value) =>
    states.push(
      typeof value === 'string'
        ? { device_feature_external_id: ids.feature(deviceId, key), text: value }
        : { device_feature_external_id: ids.feature(deviceId, key), state: value },
    );
  const { hotspots, perimeters, station, danger } = reading;
  if (hotspots?.status === 'ok') {
    put(FEATURE.HOTSPOTS, hotspots.count);
    // Records missing: the count is a minimum (said in the status), the nearest unknown.
    if (!hotspots.incomplete) put(FEATURE.NEAREST_HOTSPOT, hotspots.nearestKm ?? radiusKm);
  }
  if (perimeters?.status === 'ok') {
    put(FEATURE.PERIMETERS, perimeters.count);
    put(FEATURE.NEAREST_PERIMETER, perimeters.nearestKm ?? radiusKm);
  }
  if (station?.status === 'ok') {
    put(FEATURE.FWI, Math.round(station.fwi));
    put(FEATURE.STATION, stationText(station));
  }
  if (danger?.status === 'ok') {
    put(FEATURE.DANGER, danger.level);
  }
  return states;
}
