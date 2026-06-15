/**
 * data.js — Caricamento e refresh dei dati
 *
 * Unico punto da cui i viaggi vengono (ri)caricati dall'API.
 */

import * as api from './api.js';
import { state, setTrips } from './state.js';
import { renderCurrentView } from './router.js';
import { showToast } from './ui/toast.js';
import { updateSyncGate } from './ui/syncGate.js';
import { t } from './i18n.js';

// Baseline per il polling in main.js: evita toast "nuove foto" dopo upload propri
let _pollCounts = null;
let _suppressNewPhotosUntil = 0;

export function getPollCounts() {
  return _pollCounts;
}

export function setPollCounts(counts) {
  _pollCounts = counts;
}

/** Sopprime il toast sync per foto caricate da questa sessione (upload lunghi). */
export function suppressNewPhotoToast(ms = 90_000) {
  _suppressNewPhotosUntil = Date.now() + ms;
}

export function shouldShowNewPhotosToast(photosBefore, photosAfter) {
  if (photosAfter <= photosBefore) return false;
  return Date.now() > _suppressNewPhotosUntil;
}

export async function refreshPollBaseline() {
  try {
    const status = await api.fetchStatus();
    _pollCounts = `${status.trips}/${status.photos}`;
    if (status.telegram !== undefined) state.tgOk = Boolean(status.telegram);
    state.serverOk = true;
    updateSyncGate();
    return status;
  } catch {
    return null;
  }
}

export async function reloadTrips({ render = true, silent = false } = {}) {
  try {
    const trips = await api.fetchTrips();
    setTrips(trips);
    state.serverOk = true;
  } catch (err) {
    state.serverOk = false;
    state.loaded = true;
    if (!silent) showToast(t('toast.serverDown'), 'neutral');
    console.warn('[data] reload fallito:', err.message);
  }
  updateSyncGate();
  if (render) renderCurrentView();
}
