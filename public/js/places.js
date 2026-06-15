/**
 * places.js — Etichette luoghi localizzate (Nominatim reverse, cache client)
 */

import * as api from './api.js';
import { getLang } from './i18n.js';

const cache = new Map();
let warmGen = 0;

export function clearPlaceLabels() {
  cache.clear();
  warmGen++;
}

export function getLocalizedTrip(trip) {
  if (!trip?.id) return null;
  return cache.get(`${trip.id}:${getLang()}`) || null;
}

/** Precarica nomi città/paese nella lingua corrente (mappa, liste, hero). */
export function warmTripLabels(trips, { onUpdate } = {}) {
  const lang = getLang();
  const gen = ++warmGen;
  const pending = (trips || []).filter(t => {
    if (t.lat == null || t.lon == null) return false;
    return !cache.has(`${t.id}:${lang}`);
  });

  if (!pending.length) return;

  (async () => {
    for (const trip of pending) {
      if (gen !== warmGen) return;
      try {
        const label = await api.reversePlace(trip.lat, trip.lon, lang);
        if (gen !== warmGen) return;
        if (label?.dest || label?.country) {
          cache.set(`${trip.id}:${lang}`, label);
          onUpdate?.(trip.id);
        }
      } catch {
        /* fallback su dest/country salvati */
      }
    }
  })();
}
