/**
 * login.js — Bootstrap pagina di accesso (separata dall'app)
 */

import * as api from './api.js';
import { initAuth, showVerifyEmail, refreshAuthLabels } from './ui/auth.js';
import { initLang } from './ui/lang.js';
import { applyStatic, onLangChange } from './i18n.js';
import { initTheme } from './ui/theme.js';
import { initPasswordToggle, refreshPasswordToggleLabels } from './ui/passwordToggle.js';
import { initPwa, syncPwaInstall } from './pwa.js';

const APP_URL = '/app';

function goToApp() {
  const next = new URLSearchParams(location.search).get('next');
  if (next && next.startsWith('/app') && !next.startsWith('//')) {
    location.assign(next);
    return;
  }
  location.assign(APP_URL);
}

async function boot() {
  initPwa();
  initLang();
  applyStatic();

  onLangChange(() => {
    refreshAuthLabels();
    refreshPasswordToggleLabels();
  });

  initTheme();
  initPasswordToggle();
  initAuth({ onSuccess: goToApp });

  let me = null;
  try { me = await api.fetchMe(); } catch { /* non autenticato */ }
  finally { document.getElementById('ld')?.classList.add('gone'); }

  setTimeout(syncPwaInstall, 400);

  if (me) {
    if (me.emailVerified === false) {
      showVerifyEmail(me);
    } else {
      goToApp();
    }
  } else {
    setTimeout(() => document.getElementById('authUser')?.focus(), 80);
  }
}

boot();
