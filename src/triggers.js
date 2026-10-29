// -----------------------------------------------------------------------------
// Two readings of a house -> scene events, and the memory carried from one to
// the next (kept in /data). Pure. A value before that is unknown never counts
// as a change: nothing fires on the first reading of a house.
//
//   hotspot_nearby       a distance goes from quiet to "a hotspot within it";
//                        once per episode, re-armed after REARM_READS reads in
//                        a row without any hotspot within it
//   fire_danger_raised   the danger class reaches a level it was under
// -----------------------------------------------------------------------------

import { DISTANCES, MEMORY_MAX_AGE, REARM_READS, SCENE_TRIGGERS } from './constants.js';
import { compassPoint } from './geo.js';
import { dangerName } from './i18n.js';

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** A memory read back from /data, or undefined when unusable or too old. */
export function validMemory(memory, now) {
  if (!memory || typeof memory !== 'object' || !Number.isFinite(memory.at)) {
    return undefined;
  }
  if (memory.at > now || now - memory.at > MEMORY_MAX_AGE) {
    return undefined;
  }
  const zones = {};
  for (const d of DISTANCES) {
    const z = memory.zones?.[d];
    if (z && typeof z.active === 'boolean' && Number.isInteger(z.empty) && z.empty >= 0) {
      zones[d] = { active: z.active, empty: Math.min(z.empty, REARM_READS) };
    }
  }
  const danger =
    Number.isInteger(memory.danger) && memory.danger >= 1 && memory.danger <= 5
      ? memory.danger
      : undefined;
  return { at: memory.at, zones, danger };
}

/**
 * The events between the memory of a house and its new reading, and the new
 * memory. `context` = { deviceId, language, now }.
 */
export function houseEvents(memory, reading, { deviceId, language = 'fr', now }) {
  const events = [];
  const next = { at: now, zones: { ...(memory?.zones ?? {}) }, danger: memory?.danger };
  const hotspots = reading.hotspots;
  if (hotspots?.status === 'ok') {
    for (const d of DISTANCES) {
      const before = memory?.zones?.[d];
      const zone = hotspots.zones[d];
      if (zone.count > 0) {
        if (before && !before.active) {
          events.push({
            key: SCENE_TRIGGERS.HOTSPOT,
            data: {
              house: deviceId,
              distance: String(d),
              km: zone.nearest.km,
              direction: compassPoint(zone.nearest.bearing, language),
              bearing: zone.nearest.bearing,
              count: zone.count,
              detected_at: iso(zone.nearest.at),
              satellite: zone.nearest.satellite || null,
            },
          });
        }
        next.zones[d] = { active: true, empty: 0 };
      } else if (before?.active) {
        const empty = before.empty + 1;
        next.zones[d] = { active: empty < REARM_READS, empty };
      } else {
        next.zones[d] = { active: false, empty: 0 };
      }
    }
  }
  const danger = reading.danger;
  if (danger?.status === 'ok') {
    if (memory?.danger !== undefined && danger.level > memory.danger) {
      for (let level = Math.max(2, memory.danger + 1); level <= danger.level; level += 1) {
        events.push({
          key: SCENE_TRIGGERS.DANGER,
          data: {
            house: deviceId,
            level: String(level),
            level_name: dangerName(danger.level, language),
            current_level: danger.level,
            previous_level: memory.danger,
            fwi: reading.station?.status === 'ok' ? Math.round(reading.station.fwi) : null,
            map_date: danger.date ?? null,
          },
        });
      }
    }
    next.danger = danger.level;
  }
  return { events, memory: next };
}
