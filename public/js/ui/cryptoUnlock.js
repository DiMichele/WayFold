/**
 * ui/cryptoUnlock.js — Sblocco E2E con password su un nuovo dispositivo
 */

import { t } from '../i18n.js';
import { cryptoUnlockWithPassword } from '../crypto/authCrypto.js';
import { sessionReady } from '../crypto/sessionCrypto.js';

export function promptCryptoUnlock(user) {
  return new Promise(resolve => {
    const gate = document.getElementById('cryptoGate');
    const form = document.getElementById('cryptoUnlockForm');
    const input = document.getElementById('cryptoUnlockPass');
    const err = document.getElementById('cryptoUnlockErr');
    const btn = document.getElementById('cryptoUnlockSubmit');
    if (!gate || !form || !input) {
      resolve(sessionReady());
      return;
    }

    const close = (ok) => {
      gate.classList.remove('open');
      gate.setAttribute('aria-hidden', 'true');
      form.onsubmit = null;
      resolve(ok);
    };

    err.textContent = '';
    err.hidden = true;
    input.value = '';
    gate.classList.add('open');
    gate.setAttribute('aria-hidden', 'false');
    document.getElementById('cryptoUnlockLogout')?.addEventListener('click', () => {
      document.getElementById('tbLogout')?.click();
    }, { once: true });
    setTimeout(() => {
      try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    }, 80);

    form.onsubmit = async (e) => {
      e.preventDefault();
      const password = input.value;
      if (!password) {
        err.textContent = t('crypto.unlockFail');
        err.hidden = false;
        return;
      }
      btn.disabled = true;
      try {
        await cryptoUnlockWithPassword(password, user);
        if (!sessionReady()) throw new Error('locked');
        input.value = '';
        close(true);
      } catch {
        err.textContent = t('crypto.unlockFail');
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    };
  });
}
