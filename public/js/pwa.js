/**
 * pwa.js — Installazione PWA e aggiornamenti del service worker.
 *
 *  - Installazione: pillola con pulsante che apre il prompt nativo (beforeinstallprompt).
 *  - L'evento viene catturato subito in index.html (prima dei moduli ES).
 *  - Aggiornamenti SW: applicati in automatico quando lasci il tab, senza banner.
 */

const VISIBLE = 'is-visible';

let deferredPrompt = null;
let swRegistration = null;
let refreshing = false;
let installDismissed = false;
let installUiReady = false;
let silentUpdateScheduled = false;

function adoptDeferredPrompt() {
  if (!deferredPrompt && window.__wfBip) deferredPrompt = window.__wfBip;
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isMobileInstallTarget() {
  if (/iPad|iPhone|iPod|Android/i.test(navigator.userAgent)) return true;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function shouldShowPwaUi() {
  return isStandalone() || isMobileInstallTarget();
}

function setBarVisible(el, on) {
  if (!el) return;
  el.classList.toggle(VISIBLE, on);
  el.hidden = !on;
}

function hideInstallBanner() {
  setBarVisible(document.getElementById('pwaInstall'), false);
}

function showInstallBanner() {
  setBarVisible(document.getElementById('pwaInstall'), true);
}

export function syncPwaInstall() {
  adoptDeferredPrompt();
  syncInstallUi();
}

function syncInstallUi() {
  const canInstall = installUiReady && shouldShowPwaUi() && !isStandalone()
    && !installDismissed && !!deferredPrompt;

  if (canInstall) showInstallBanner();
  else hideInstallBanner();
}

function initInstall() {
  if (!shouldShowPwaUi() || isStandalone()) {
    hideInstallBanner();
    return;
  }

  const installBtn = document.getElementById('pwaInstallBtn');
  const closeBtn = document.getElementById('pwaInstallClose');
  if (!installBtn) return;

  closeBtn?.addEventListener('click', () => {
    installDismissed = true;
    hideInstallBanner();
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    window.__wfBip = null;
    hideInstallBanner();
    syncInstallUi();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.__wfBip = null;
    hideInstallBanner();
  });

  window.addEventListener('wf:installready', () => {
    adoptDeferredPrompt();
    syncInstallUi();
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    window.__wfBip = e;
    syncInstallUi();
  });

  installUiReady = true;
  adoptDeferredPrompt();
  syncInstallUi();
}

function hasPendingUpdate(registration) {
  return !!(registration?.waiting && navigator.serviceWorker.controller);
}

function isBusyUi() {
  return !!document.querySelector('.modal.open, .lb.open, .palette.open, .auth.open');
}

function applyUpdate(registration) {
  const waiting = registration?.waiting;
  if (!waiting) return;

  waiting.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(() => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  }, 400);
}

/** Applica una nuova versione in background, senza chiedere all'utente. */
function scheduleSilentUpdate(registration) {
  if (silentUpdateScheduled || !hasPendingUpdate(registration)) return;
  silentUpdateScheduled = true;

  const run = () => {
    if (isBusyUi()) {
      setTimeout(run, 2500);
      return;
    }
    applyUpdate(registration);
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') run();
  });
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
      swRegistration = registration;
      if (hasPendingUpdate(registration)) scheduleSilentUpdate(registration);

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && hasPendingUpdate(registration)) {
            scheduleSilentUpdate(registration);
          }
        });
      });
    })
    .catch(() => {
      /* SW non registrabile: l'app resta online-only */
    });
}

export function initPwa() {
  hideInstallBanner();
  initServiceWorker();
  initInstall();
}
