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
