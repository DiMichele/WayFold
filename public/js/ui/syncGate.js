/**
 * ui/syncGate.js — Blocca l'app se server o Telegram non sono sincronizzati
 */

import { state } from '../state.js';
import { t } from '../i18n.js';
import { reloadTrips } from '../data.js';
import * as api from '../api.js';

const el = id => document.getElementById(id);

export function initSyncGate({ onRetry } = {}) {
  el('syncRetry').addEventListener('click', async () => {
    const btn = el('syncRetry');
    btn.disabled = true;
    try {
      await onRetry?.();
    } finally {
      btn.disabled = false;
    }
  });
}

/** Valuta lo stato e mostra/nasconde il blocco schermo intero. */
export function updateSyncGate() {
  let reason = null;
  if (!state.serverOk) {
    reason = 'server';
  } else if (state.tgOk === false) {
    reason = 'telegram';
  }

  state.syncBlocked = reason;

  const gate = el('syncGate');
  if (!gate) return;

  gate.classList.toggle('open', Boolean(reason));
  gate.setAttribute('aria-hidden', reason ? 'false' : 'true');

  const msg = el('syncGateMsg');
  if (msg) msg.textContent = reason ? t(`sync.blocked.${reason}`) : '';

  document.body.classList.toggle('sync-blocked', Boolean(reason));
}

export async function retrySync() {
  try {
    const status = await api.fetchStatus();
    state.serverOk = true;
    if (status.telegram !== undefined) {
      state.tgOk = Boolean(status.telegram);
    }
    await reloadTrips({ silent: true });
  } catch {
    state.serverOk = false;
  }
  updateSyncGate();
}
