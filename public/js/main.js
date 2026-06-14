/**
 * main.js — Bootstrap dell'app
 *
 * Ordine: tema → wiring UI → primo fetch → render → sync automatica.
 */

import { state } from './state.js';
import { switchView, renderCurrentView } from './router.js';
import { reloadTrips } from './data.js';
import * as api from './api.js';
import { initTheme } from './ui/theme.js';
import { initModal } from './ui/modal.js';
import { initLightbox } from './ui/lightbox.js';
import { initPalette } from './ui/palette.js';
import { initAuth, showAuth, showVerifyEmail, refreshAuthLabels } from './ui/auth.js';
import { initLang } from './ui/lang.js';
import { applyStatic, onLangChange, t } from './i18n.js';
import { initRoad } from './views/road.js';
import { initAccount } from './views/account.js';
import { openTripForm } from './ui/modal.js';
import { showToast } from './ui/toast.js';
import { initSyncGate, updateSyncGate, retrySync } from './ui/syncGate.js';
import { initPasswordToggle, refreshPasswordToggleLabels } from './ui/passwordToggle.js';
import { initJourneyScrolls, refreshJourneyScrollsInView } from './ui/journeyScroll.js';
import { initTooltips } from './ui/tooltip.js';
import { initPwa, syncPwaInstall } from './pwa.js';

// ─── Navigazione (tabs mobile + sidebar desktop) ───────────────────────────

function initNav() {
  document.querySelectorAll('[data-v]').forEach(b =>
    b.addEventListener('click', () => switchView(b.dataset.v))
  );

  document.querySelectorAll('.nav-new-trip').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      openTripForm({
        onSaved: async saved => {
          await reloadTrips({ silent: true, render: false });
          if (state.view === 'gallery') state.galTripId = saved.id;
          renderCurrentView();
        },
      });
      btn.blur();
    });
  });
}

// ─── Reveal on scroll (motion) ─────────────────────────────────────────────

function initReveal() {
  const observer = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        observer.unobserve(e.target);
      }
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -24px 0px' });

  // Osserva gli elementi marcati, anche quelli creati dopo i render
  const watch = () => document.querySelectorAll('.rv:not(.in)').forEach(n => observer.observe(n));
  watch();
  new MutationObserver(watch).observe(document.querySelector('.app'), { childList: true, subtree: true });
}

// ─── Sync automatica (polling) ─────────────────────────────────────────────

const POLL_MS = 12000;
let lastCounts = null;

async function poll() {
  if (document.hidden) return;
  let status;
  try {
    status = await api.fetchStatus();
  } catch {
    state.serverOk = false;
    updateSyncGate();
    return;
  }
  state.serverOk = true;
  if (status.telegram !== undefined) {
    state.tgOk = Boolean(status.telegram);
  }

  updateSyncGate();

  const counts = `${status.trips}/${status.photos}`;
  if (lastCounts !== null && counts !== lastCounts) {
    const photosBefore = Number(lastCounts.split('/')[1]);
    api.invalidatePhotoCache();
    await reloadTrips({ silent: true });
    if (status.photos > photosBefore) showToast(t('toast.newPhotos'));
  }
  lastCounts = counts;
}

// ─── Utente e ruoli ────────────────────────────────────────────────────────

function applyUser(user) {
  state.user = user;
  document.body.dataset.role = user.role;
  document.getElementById('sideUser').textContent = user.username;
}

async function doLogout() {
  try { await api.logout(); } catch { /* comunque ricarica */ }
  location.reload();
}

// ─── Resize ────────────────────────────────────────────────────────────────

function initResize() {
  let timer = null;
  window.addEventListener('resize', () => {
    clearTimeout(timer);
    timer = setTimeout(() => renderCurrentView(), 150);
  });
}

// ─── Boot ──────────────────────────────────────────────────────────────────

let _appStarted = false;

async function startApp(user) {
  applyUser(user);

  if (_appStarted) {
    // Re-login dopo sessione scaduta: ricarica i dati e basta
    await reloadTrips();
    return;
  }
  _appStarted = true;

  await reloadTrips({ silent: true, render: false });
  renderCurrentView();
  refreshJourneyScrollsInView(state.view);
  updateSyncGate();

  try {
    const status = await api.fetchStatus();
    lastCounts = `${status.trips}/${status.photos}`;
    if (status.telegram !== undefined) {
      state.tgOk = Boolean(status.telegram);
    }
    updateSyncGate();
  } catch {
    state.serverOk = false;
    updateSyncGate();
  }
  setInterval(poll, POLL_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
  syncPwaInstall();
}

async function boot() {
  initPwa();
  initLang();
  applyStatic();

  onLangChange(() => {
    refreshAuthLabels();
    refreshPasswordToggleLabels();
    updateSyncGate();
    if (state.user) applyUser(state.user);
    renderCurrentView();
  });

  initTheme();
  initPasswordToggle();
  initModal();
  initLightbox();
  initPalette();
  initAuth({ onSuccess: startApp });
  initSyncGate({ onRetry: retrySync });
  initRoad();
  initAccount();
  initJourneyScrolls();
  initTooltips();
  initNav();
  initReveal();
  initResize();

  document.getElementById('sideLogout').addEventListener('click', doLogout);
  document.getElementById('tbLogout').addEventListener('click', doLogout);
  document.getElementById('sideUser').addEventListener('click', () => switchView('account'));

  let me = null;
  try { me = await api.fetchMe(); } catch { /* non autenticato */ }

  document.getElementById('ld').classList.add('gone');
  setTimeout(syncPwaInstall, 400);

  if (me) {
    if (me.emailVerified === false) {
      showVerifyEmail(me);
    } else {
      await startApp(me);
    }
  } else {
    showAuth();
  }
}

boot();
