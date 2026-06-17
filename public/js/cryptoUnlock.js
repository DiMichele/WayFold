/**
 * cryptoUnlock.js — Prompt password per sbloccare chiavi E2E dopo reload (sessione cookie attiva)
 * La password non viene inviata al server: serve solo per derivare la master key.
 */

import { unlockUserKeys } from './crypto/userKeys.js';
import { sessionReady } from './crypto/sessionCrypto.js';
import { prefetchTripKeys } from './crypto/keyStore.js';
import { t } from './i18n.js';

let _unlockPromise = null;

function buildOverlay() {
  const el = document.createElement('div');
  el.id = 'wfCryptoUnlock';
  el.className = 'crypto-unlock-overlay';
  el.innerHTML = `
    <div class="crypto-unlock-card">
      <h2 class="crypto-unlock-title">${t('crypto.unlockTitle')}</h2>
      <p class="crypto-unlock-hint">${t('crypto.unlockHint')}</p>
      <form id="wfCryptoUnlockForm">
        <input type="password" id="wfCryptoUnlockPass" autocomplete="current-password"
          placeholder="${t('auth.password')}" required minlength="8">
        <p class="crypto-unlock-err" id="wfCryptoUnlockErr" hidden></p>
        <button type="submit" class="crypto-unlock-btn">${t('crypto.unlockSubmit')}</button>
      </form>
    </div>`;
  document.body.appendChild(el);
  return el;
}

/**
 * Chiede la password se le chiavi E2E non sono in memoria.
 * @returns {Promise<boolean>} true se pronto
 */
export function ensureCryptoUnlocked(user) {
  if (!user?.publicKey) return Promise.resolve(true);
  if (sessionReady()) return Promise.resolve(true);
  if (_unlockPromise) return _unlockPromise;

  _unlockPromise = new Promise(resolve => {
    const overlay = buildOverlay();
    const form = overlay.querySelector('#wfCryptoUnlockForm');
    const input = overlay.querySelector('#wfCryptoUnlockPass');
    const err = overlay.querySelector('#wfCryptoUnlockErr');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      err.hidden = true;
      const password = input.value;
      try {
        await unlockUserKeys(password, user);
        overlay.remove();
        _unlockPromise = null;
        resolve(true);
      } catch {
        err.textContent = t('crypto.unlockFail');
        err.hidden = false;
      }
    });

    setTimeout(() => input.focus(), 80);
  });

  return _unlockPromise;
}

export async function unlockAndPrefetch(user, trips) {
  const ok = await ensureCryptoUnlocked(user);
  if (ok && trips?.length) await prefetchTripKeys(trips);
}
