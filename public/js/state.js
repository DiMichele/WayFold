/**
 * state.js — Stato centralizzato dell'app
 *
 * Unica fonte di verità per i dati e le selezioni correnti.
 * Le viste leggono da qui e non tengono copie proprie.
 */

export const state = {
  user: null,         // utente autenticato { id, username, email, role }
  trips: [],          // viaggi dall'API, ordinati cronologicamente
  loaded: false,      // primo fetch completato
  serverOk: true,     // ultimo contatto col server riuscito
  tgOk: null,         // Telegram configurato (null = sconosciuto)
  syncBlocked: null,  // null | 'server' | 'telegram'
  view: 'road',       // vista attiva: road | gallery | map | account
  heroIdx: 0,         // indice del viaggio nell'hero
  selTripId: null,    // viaggio selezionato nella lista (detail box)
  galTripId: null,    // viaggio aperto nella gallery
  search: '',         // testo di ricerca corrente
};

/** Imposta i viaggi (ordinati per anno, poi per data di creazione). */
export function setTrips(trips) {
  state.trips = [...trips].sort((a, b) =>
    (a.year ?? 0) - (b.year ?? 0) || a.createdAt.localeCompare(b.createdAt)
  );
  state.loaded = true;

  // Riallinea le selezioni se i dati sono cambiati
  if (state.heroIdx >= state.trips.length || state.heroIdx < 0) {
    state.heroIdx = Math.max(0, state.trips.length - 1);
  }
  if (state.selTripId !== null && !getTrip(state.selTripId)) state.selTripId = null;
  if (state.galTripId !== null && !getTrip(state.galTripId)) state.galTripId = null;
}

export function getTrip(id) {
  return state.trips.find(t => t.id === Number(id)) || null;
}

/** Viaggi filtrati dalla ricerca corrente. */
export function visibleTrips() {
  const q = state.search.trim().toLowerCase();
  if (!q) return state.trips;
  return state.trips.filter(t => {
    const haystack = [
      t.dest, t.name, t.country, t.continent, t.type, t.kind,
      t.year != null ? String(t.year) : '',
      t.year != null ? String(t.year) : '',
      ...(t.tags || []),
    ].join(' ').toLowerCase();
    return haystack.includes(q);
  });
}
