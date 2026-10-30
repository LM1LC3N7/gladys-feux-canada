// -----------------------------------------------------------------------------
// Runtime texts: feature names, danger classes, the connection status and the
// test button (English and French). The status is bounded (LIMITS.status).
// -----------------------------------------------------------------------------

import { DANGER_NEAR_KM, LIMITS, STATION_SEARCH_KM } from './constants.js';

export const FEATURE_NAMES = {
  hotspots: {
    en: 'Satellite hotspots (24 h, radius)',
    fr: 'Points chauds satellite (24 h, rayon)',
  },
  nearestHotspot: { en: 'Nearest hotspot', fr: 'Point chaud le plus proche' },
  perimeters: { en: 'Active fire perimeters (radius)', fr: 'Périmètres de feu actifs (rayon)' },
  nearestPerimeter: { en: 'Nearest active perimeter', fr: 'Périmètre actif le plus proche' },
  fwi: { en: 'Fire Weather Index (FWI)', fr: 'Indice forêt-météo (IFM)' },
  danger: { en: 'Fire danger (1 low - 5 extreme)', fr: "Danger d'incendie (1 bas - 5 extrême)" },
  station: { en: 'Fire weather station', fr: 'Station météo-feu' },
};

const DANGER_NAMES = {
  en: ['Low', 'Moderate', 'High', 'Very high', 'Extreme'],
  fr: ['Bas', 'Modéré', 'Élevé', 'Très élevé', 'Extrême'],
};

/** The name of a danger level 1-5. */
export function dangerName(level, language = 'en') {
  return (DANGER_NAMES[language] ?? DANGER_NAMES.en)[level - 1] ?? String(level);
}

const both = (en, fr) => ({ en, fr });
const cut = (s) => (s.length > LIMITS.status ? `${s.slice(0, LIMITS.status - 1)}…` : s);
const hhmm = (ms) => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Join the lines of each language into one bounded status. */
export function joinLines(lines) {
  return {
    en: cut(lines.map((l) => l.en).join(' ')),
    fr: cut(lines.map((l) => l.fr).join(' ')),
  };
}

const CAVEAT = both(
  'Satellite hotspots are heat detections, not confirmed fires.',
  'Les points chauds satellite sont des détections de chaleur, pas des feux confirmés.',
);

export const T = {
  caveat: CAVEAT,
  data: {
    unreadable: both(
      '/data was unreadable at the start: the time of the last read and the pause were lost (the file is kept aside).',
      "/data était illisible au démarrage : l'heure de la dernière lecture et la pause ont été perdues (le fichier est mis de côté).",
    ),
    unwritable: both(
      '/data cannot be written: after a restart, the interval and a pause would not be kept.',
      "/data ne peut pas être écrit : après un redémarrage, l'intervalle et une pause ne seraient pas gardés.",
    ),
    frozen: both(
      '/data does not answer (write still pending): the reads go on, but a restart would not keep the interval.',
      "/data ne répond pas (écriture en attente) : les lectures continuent, mais un redémarrage ne garderait pas l'intervalle.",
    ),
  },
  notStarted: both(
    'The integration is not started yet (waiting for Gladys).',
    "L'intégration n'est pas encore démarrée (en attente de Gladys).",
  ),
  waitingConfig: (attempt) =>
    both(
      `Waiting for the configuration from Gladys (attempt ${attempt}).`,
      `En attente de la configuration de Gladys (essai ${attempt}).`,
    ),
  housesUnavailable: both(
    'The houses of Gladys could not be read (location access refused?): nothing is read.',
    "Les maisons de Gladys n'ont pas pu être lues (accès à la position refusé ?) : rien n'est lu.",
  ),
  noLocatedHouse: both(
    'No located house in Gladys: set the location of a house (Settings > Houses).',
    'Aucune maison localisée dans Gladys : renseignez la position d’une maison (Paramètres > Maisons).',
  ),
  noDevice: (n) =>
    both(
      `${n} located house(s) offered in Discovery: create the device to start the reads.`,
      `${n} maison(s) localisée(s) proposée(s) dans la Découverte : créez l'appareil pour lancer les lectures.`,
    ),
  orphan: (name) =>
    both(
      `The house of "${name}" no longer exists or is no longer located: not read.`,
      `La maison de « ${name} » n'existe plus ou n'est plus localisée : non lue.`,
    ),
  tooManyHouses: (n) =>
    both(`Only the first ${n} houses are read.`, `Seules les ${n} premières maisons sont lues.`),
  read: (count, at) =>
    both(`Read at ${hhmm(at)}: ${count} house(s).`, `Lecture de ${hhmm(at)} : ${count} maison(s).`),
  house: (fullName, r) => {
    // Bounded: five long names must not push the reasons out of the status.
    const name = fullName.length > 40 ? `${fullName.slice(0, 39)}…` : fullName;
    const en = [];
    const fr = [];
    const add = (e, f) => {
      en.push(e);
      fr.push(f);
    };
    const { hotspots, perimeters, station, danger } = r;
    if (hotspots?.status === 'ok') {
      const n = hotspots.incomplete ? `at least ${hotspots.count}` : `${hotspots.count}`;
      const f = hotspots.incomplete ? `au moins ${hotspots.count}` : `${hotspots.count}`;
      add(`${n} hotspot(s) within the radius`, `${f} point(s) chaud(s) dans le rayon`);
    }
    const where = (country) =>
      country === 'doubt'
        ? both(
            'within 1 km of the US border, cannot tell',
            'à moins de 1 km de la frontière, impossible à dire',
          )
        : both('outside Canada', 'hors du Canada');
    if (perimeters?.status === 'ok') {
      add(`${perimeters.count} active perimeter(s)`, `${perimeters.count} périmètre(s) actif(s)`);
    } else if (perimeters?.status === 'outside') {
      const w = where(perimeters.country);
      add(`no perimeter published (${w.en})`, `pas de périmètre publié (${w.fr})`);
    }
    if (station?.status === 'ok') {
      const fwi = Math.round(station.fwi);
      add(
        `FWI ${fwi} at ${station.name} (${station.km} km)`,
        `IFM ${fwi} à ${station.name} (${station.km} km)`,
      );
    } else if (station?.status === 'none') {
      add(
        `no FWI (no station report of the last 36 h within ${STATION_SEARCH_KM} km)`,
        `pas d'IFM (aucun relevé de station des dernières 36 h à moins de ${STATION_SEARCH_KM} km)`,
      );
    }
    if (danger?.status === 'ok') {
      const en = `danger ${dangerName(danger.level, 'en').toLowerCase()}`;
      const fr = `danger ${dangerName(danger.level, 'fr').toLowerCase()}`;
      add(
        danger.km > 0 ? `${en} (nearest area of the map, ${danger.km} km)` : en,
        danger.km > 0 ? `${fr} (zone de la carte la plus proche, ${danger.km} km)` : fr,
      );
    } else if (danger?.status === 'outside') {
      const w = where(danger.country);
      add(`no danger class (${w.en})`, `pas de classe de danger (${w.fr})`);
    } else if (danger?.status === 'none') {
      add(
        `no danger class: no area of the map within ${DANGER_NEAR_KM} km (the far North may be uncovered)`,
        `pas de classe de danger : aucune zone de la carte à moins de ${DANGER_NEAR_KM} km (le Grand Nord peut ne pas être couvert)`,
      );
    }
    return both(
      `${name}: ${en.join(', ') || 'nothing published'}.`,
      `${name} : ${fr.join(', ') || 'rien de publié'}.`,
    );
  },
  hotspotsStale: (newest) =>
    newest === null
      ? both(
          'Hotspots: the layer is empty, nothing published (source silent).',
          'Points chauds : la couche est vide, rien de publié (source muette).',
        )
      : both(
          `Hotspots: the newest is from ${day(newest)} ${hhmm(newest)}, the layer is stale: not published.`,
          `Points chauds : le plus récent date du ${day(newest)} ${hhmm(newest)}, couche périmée : non publiés.`,
        ),
  perimetersStale: (newest) =>
    newest === null
      ? both(
          'Perimeters: none this season, not published.',
          'Périmètres : aucun cette saison, non publiés.',
        )
      : both(
          `Perimeters: not updated since ${day(newest)} (season over?), not published.`,
          `Périmètres : pas mis à jour depuis le ${day(newest)} (fin de saison ?), non publiés.`,
        ),
  dangerStale: (date) =>
    both(
      `Fire danger: the map is dated ${date}, stale: not published.`,
      `Danger d'incendie : la carte date du ${date}, périmée : non publié.`,
    ),
  hotspotsIncomplete: (unreadable, truncated) =>
    both(
      `Hotspots: ${truncated ? 'more than one answer holds' : `${unreadable} unreadable record(s)`}, the count is a minimum and the nearest is not published.`,
      `Points chauds : ${truncated ? "plus qu'une réponse n'en contient" : `${unreadable} enregistrement(s) illisible(s)`}, le décompte est un minimum et le plus proche n'est pas publié.`,
    ),
  partFailed: (part, message) =>
    both(
      `${PART_NAMES[part].en}: read failed (${message}).`,
      `${PART_NAMES[part].fr} : lecture échouée (${message}).`,
    ),
  paused: (until, status) =>
    both(
      `The CWFIS server asked to wait (HTTP ${status}): next read after ${hhmm(until)}.`,
      `Le serveur du SCIF a demandé d'attendre (HTTP ${status}) : prochaine lecture après ${hhmm(until)}.`,
    ),
  unreachable: (message, nextAt) =>
    both(
      `CWFIS server unreachable (${message}): new try at ${hhmm(nextAt)}.`,
      `Serveur du SCIF injoignable (${message}) : nouvel essai à ${hhmm(nextAt)}.`,
    ),
  test: {
    notDue: (nextAt) =>
      both(
        `Next read at ${hhmm(nextAt)} (never sooner than the interval).`,
        `Prochaine lecture à ${hhmm(nextAt)} (jamais plus tôt que l'intervalle).`,
      ),
    never: both('No read yet.', 'Aucune lecture encore.'),
    probeOk: (newest) =>
      both(
        `The CWFIS server answers; newest hotspot: ${newest === null ? 'none' : `${day(newest)} ${hhmm(newest)}`}.`,
        `Le serveur du SCIF répond ; point chaud le plus récent : ${newest === null ? 'aucun' : `${day(newest)} ${hhmm(newest)}`}.`,
      ),
  },
};

const PART_NAMES = {
  hotspots: both('Hotspots', 'Points chauds'),
  perimeters: both('Perimeters', 'Périmètres'),
  station: both('Fire weather station', 'Station météo-feu'),
  danger: both('Fire danger', "Danger d'incendie"),
};
