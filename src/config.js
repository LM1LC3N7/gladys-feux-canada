// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// Nothing in it is secret: the houses come from Gladys (`location: true`).
// -----------------------------------------------------------------------------

import { LANGUAGES, POLL, RADIUS } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest.
export const DEFAULTS = {
  radius_km: RADIUS.default,
  poll_minutes: POLL.default,
  language: 'fr',
};

/** A number from the form: empty, null or not a number is the default; bounded, rounded. */
const number = (value, fallback, { min, max }) => {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') {
    return fallback;
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) && String(value).trim() !== ''
    ? Math.min(max, Math.max(min, Math.round(n)))
    : fallback;
};

export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const language = String(source.language ?? DEFAULTS.language).toLowerCase();
  return {
    radiusKm: number(source.radius_km, DEFAULTS.radius_km, RADIUS),
    pollMinutes: number(source.poll_minutes, DEFAULTS.poll_minutes, POLL),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
