/**
 * pwa.js — Installazione PWA e aggiornamenti del service worker.
 *
 *  - Installazione nativa: pillola con beforeinstallprompt (Android Chrome).
 *  - Guida manuale: iOS Safari e altri browser mobile senza prompt nativo.
 *  - Aggiornamenti SW: applicati in automatico quando lasci il tab, senza banner.
 */

const VISIBLE = 'is-visible';
const DISMISS_KEY = 'wf:pwa-install-dismissed';
const BIP_WAIT_MS = 2800;

let deferredPrompt = null;
let swRegistration = null;
let refreshing = false;
let installDismissed = false;
let installUiReady = false;
let silentUpdateScheduled = false;
let guideFallbackReady = false;
let bipWaitTimer = null;

function adoptDeferredPrompt() {
  if (!deferredPrompt && window.__wfBip) deferredPrompt = window.__wfBip;
}

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function isIos() {
  if (/iPad|iPhone|iPod/i.test(navigator.userAgent)) return true;
  return navigator.maxTouchPoints > 1 && /Mac/i.test(navigator.userAgent);
}

function isMobileInstallTarget() {
  if (/iPad|iPhone|iPod|Android/i.test(navigator.userAgent)) return true;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function shouldShowPwaUi() {
  return isStandalone() || isMobileInstallTarget();
}

function readDismissed() {
  if (installDismissed) return true;
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissInstallUi() {
  installDismissed = true;
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* sessionStorage non disponibile */
  }
  hideInstallBanner();
  hideInstallGuide();
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
  hideInstallGuide();
  setBarVisible(document.getElementById('pwaInstall'), true);
}

function hideInstallGuide() {
  setBarVisible(document.getElementById('pwaInstallGuide'), false);
}

function showInstallGuide() {
  hideInstallBanner();

  const guide = document.getElementById('pwaInstallGuide');
  const iosSteps = document.getElementById('pwaInstallIosSteps');
  const fallback = document.getElementById('pwaInstallFallback');
  if (!guide) return;

  const useIosGuide = isIos();
  if (iosSteps) iosSteps.hidden = !useIosGuide;
  if (fallback) fallback.hidden = useIosGuide;

  setBarVisible(guide, true);
}

function clearBipWaitTimer() {
  if (bipWaitTimer) {
    clearTimeout(bipWaitTimer);
    bipWaitTimer = null;
  }
}

function scheduleGuideFallback() {
  clearBipWaitTimer();
  if (!isMobileInstallTarget() || isIos()) {
    guideFallbackReady = true;
    syncInstallUi();
    return;
  }

  bipWaitTimer = setTimeout(() => {
    guideFallbackReady = true;
    syncInstallUi();
  }, BIP_WAIT_MS);
}

export function syncPwaInstall() {
  adoptDeferredPrompt();
  syncInstallUi();
}

function syncInstallUi() {
  if (!installUiReady || !shouldShowPwaUi() || isStandalone() || readDismissed()) {
    hideInstallBanner();
    hideInstallGuide();
    return;
  }

  if (deferredPrompt) {
    clearBipWaitTimer();
    showInstallBanner();
    return;
  }

  if (isIos() || guideFallbackReady) {
    showInstallGuide();
    return;
  }

  hideInstallBanner();
  hideInstallGuide();
}

function initInstall() {
  if (!shouldShowPwaUi() || isStandalone()) {
    hideInstallBanner();
    hideInstallGuide();
    return;
  }

  const installBtn = document.getElementById('pwaInstallBtn');
  const closeBtn = document.getElementById('pwaInstallClose');
  const guideCloseBtn = document.getElementById('pwaInstallGuideClose');
  if (!installBtn) return;

  closeBtn?.addEventListener('click', dismissInstallUi);
  guideCloseBtn?.addEventListener('click', dismissInstallUi);

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    window.__wfBip = null;
    dismissInstallUi();
    syncInstallUi();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.__wfBip = null;
    dismissInstallUi();
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
  scheduleGuideFallback();
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
  hideInstallGuide();
  initServiceWorker();
  initInstall();
}
