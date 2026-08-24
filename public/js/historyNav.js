/**
 * historyNav.js — Navigazione con History API per SPA / PWA
 *
 * Ogni cambio vista, album o overlay aggiunge una voce nello stack del browser,
 * così il pulsante "indietro" (soprattutto in standalone PWA) torna alla schermata
 * precedente invece di chiudere l'app.
 */

import { state, getTrip } from './state.js';
import { applyView } from './router.js';
import { showToast } from './ui/toast.js';
import { t } from './i18n.js';

const VIEWS = new Set(['road', 'gallery', 'map', 'account']);
const EXIT_CONFIRM_MS = 2500;

let restoring = false;
let ready = false;
let lastSnap = null;
let exitConfirmPending = false;
let exitConfirmTimer = null;
let exitingApp = false;

function isLightboxOpen() {
  return document.getElementById('lb')?.classList.contains('open');
}

function isModalOpen() {
  return document.getElementById('modal')?.classList.contains('open');
}

function isPaletteOpen() {
  return document.getElementById('palette')?.classList.contains('open');
}

function isHomeSnap(snap) {
  const s = normalizeSnap(snap);
  return s.view === 'road' && !s.overlay;
}

function disarmExitConfirm() {
  exitConfirmPending = false;
  clearTimeout(exitConfirmTimer);
  exitConfirmTimer = null;
}

function armExitConfirm() {
  exitConfirmPending = true;
  clearTimeout(exitConfirmTimer);
  exitConfirmTimer = setTimeout(() => { exitConfirmPending = false; }, EXIT_CONFIRM_MS);
}

function snapUrl(snap) {
  return `${location.pathname}${location.search}${toHash(snap)}`;
}

function ensureExitBuffer() {
  if (!ready || restoring || !isHomeSnap(history.state)) return;
  if (history.state?.exitBuffer) return;
  const snap = { ...normalizeSnap(history.state), exitBuffer: true };
  history.pushState(snap, '', snapUrl(snap));
  lastSnap = snap;
}

function handleHomeExitAttempt(toSnap) {
  if (exitConfirmPending) {
    disarmExitConfirm();
    exitingApp = true;
    lastSnap = toSnap;
    restoring = false;
    history.back();
    return;
  }

  showToast(t('nav.pressBackAgainToExit'), 'neutral');
  armExitConfirm();
  const buffered = { ...normalizeSnap(toSnap), exitBuffer: true };
  history.pushState(buffered, '', snapUrl(buffered));
  lastSnap = buffered;
  void applySnap(toSnap).finally(() => { restoring = false; });
}

function emptySnap() {
  return { view: 'road', galTripId: null, overlay: null, lbTripId: null, lbIdx: 0 };
}

function normalizeSnap(raw) {
  const snap = { ...emptySnap(), ...raw };
  if (!VIEWS.has(snap.view)) snap.view = 'road';
  if (snap.galTripId != null) snap.galTripId = Number(snap.galTripId) || null;
  if (snap.lbTripId != null) snap.lbTripId = Number(snap.lbTripId) || null;
  if (snap.lbIdx != null) snap.lbIdx = Number(snap.lbIdx) || 0;
  if (!snap.overlay) {
    snap.overlay = null;
    snap.lbTripId = null;
    snap.lbIdx = 0;
  }
  return snap;
}

export function currentSnap() {
  return normalizeSnap({
    view: state.view,
    galTripId: state.galTripId,
    overlay: isLightboxOpen() ? 'lightbox'
      : isModalOpen() ? 'modal'
      : isPaletteOpen() ? 'palette'
      : null,
    lbTripId: isLightboxOpen() ? state.galTripId : null,
    lbIdx: 0,
  });
}

function snapEquals(a, b) {
  return a.view === b.view
    && a.galTripId === b.galTripId
    && a.overlay === b.overlay
    && a.lbTripId === b.lbTripId
    && a.lbIdx === b.lbIdx;
}

export function parseHash() {
  const h = location.hash.replace(/^#\/?/, '').trim();
  if (!h || h === 'road') return emptySnap();
  if (h === 'map') return { ...emptySnap(), view: 'map' };
  if (h === 'account') return { ...emptySnap(), view: 'account' };
  if (h === 'gallery') return { ...emptySnap(), view: 'gallery' };

  const trip = h.match(/^gallery\/(\d+)$/);
  if (trip) {
    return { ...emptySnap(), view: 'gallery', galTripId: Number(trip[1]) };
  }

  const photo = h.match(/^gallery\/(\d+)\/p\/(\d+)$/);
  if (photo) {
    const tripId = Number(photo[1]);
    return {
      view: 'gallery',
      galTripId: tripId,
      overlay: 'lightbox',
      lbTripId: tripId,
      lbIdx: Number(photo[2]) || 0,
    };
  }

  return null;
}

function toHash(snap) {
  const s = normalizeSnap(snap);
  if (s.overlay === 'lightbox' && s.lbTripId != null) {
    return `#gallery/${s.lbTripId}/p/${s.lbIdx || 0}`;
  }
  if (s.view === 'gallery' && s.galTripId) return `#gallery/${s.galTripId}`;
  if (s.view === 'gallery') return '#gallery';
  return `#${s.view}`;
}

async function openLightboxFromSnap(snap) {
  const trip = getTrip(snap.lbTripId ?? snap.galTripId);
  if (!trip) return;
  const { openTripPhotosFromMap } = await import('./views/gallery.js');
  await openTripPhotosFromMap(trip, { idx: snap.lbIdx || 0, fromHistory: true });
}

async function applySnap(snap) {
  const s = normalizeSnap(snap);

  if (s.galTripId != null && !getTrip(s.galTripId)) {
    s.galTripId = null;
    s.overlay = null;
    s.lbTripId = null;
    s.lbIdx = 0;
  }

  const wantLb = s.overlay === 'lightbox';
  const hadLb = isLightboxOpen();
  const wantModal = s.overlay === 'modal';
  const wantPalette = s.overlay === 'palette';

  if (!wantModal && isModalOpen()) {
    const { closeModal } = await import('./ui/modal.js');
    closeModal(true);
  }
  if (!wantPalette && isPaletteOpen()) {
    const { closePalette } = await import('./ui/palette.js');
    closePalette(true);
  }
  if (!wantLb && hadLb) {
    const { closeLightbox } = await import('./ui/lightbox.js');
    closeLightbox(true);
  }

  state.view = s.view;
  if (s.view === 'gallery') state.galTripId = s.galTripId;

  applyView(s.view);

  if (wantLb && !isLightboxOpen()) {
    await openLightboxFromSnap(s);
  }
}

function pushSnap(snap, { replace = false } = {}) {
  const s = normalizeSnap(snap);
  const url = snapUrl(s);

  if (replace) {
    history.replaceState(s, '', url);
  } else {
    const prev = history.state;
    if (prev && snapEquals(normalizeSnap(prev), s)) {
      void applySnap(s).then(() => {
        lastSnap = s;
        if (isHomeSnap(s)) ensureExitBuffer();
        else disarmExitConfirm();
      });
      return;
    }
    history.pushState(s, '', url);
  }
  void applySnap(s).then(() => {
    lastSnap = s;
    if (!restoring && isHomeSnap(s)) ensureExitBuffer();
    else if (!isHomeSnap(s)) disarmExitConfirm();
  });
}

export function navigate(snap) {
  if (!ready || restoring) return;
  pushSnap(snap);
}

export function replace(snap) {
  if (!ready) return;
  const was = restoring;
  restoring = true;
  pushSnap(snap, { replace: true });
  restoring = was;
}

export function historyBack() {
  if (!ready) return;
  history.back();
}

export function pushOverlay(overlay, extra = {}) {
  if (!ready || restoring) return;
  const base = history.state ? normalizeSnap(history.state) : currentSnap();
  pushSnap({
    ...base,
    overlay,
    lbTripId: extra.lbTripId ?? base.lbTripId,
    lbIdx: extra.lbIdx ?? base.lbIdx ?? 0,
  });
}

export function notifyOverlayClosed(fromHistory = false) {
  if (fromHistory || restoring || !ready) return;
  history.back();
}

export function goToGallery(tripId = null) {
  const snap = { view: 'gallery', galTripId: tripId, overlay: null };
  if (tripId == null && state.view === 'gallery' && state.galTripId) {
    replace(snap);
    return;
  }
  navigate(snap);
}

export function initAppHistory() {
  if (ready) return;
  ready = true;

  window.addEventListener('popstate', () => {
    if (exitingApp) {
      exitingApp = false;
      return;
    }

    restoring = true;
    const toSnap = history.state ? normalizeSnap(history.state) : (parseHash() || emptySnap());
    const fromSnap = lastSnap;

    if (isHomeSnap(fromSnap) && isHomeSnap(toSnap)) {
      handleHomeExitAttempt(toSnap);
      return;
    }

    disarmExitConfirm();
    void applySnap(toSnap).finally(() => {
      lastSnap = history.state ? normalizeSnap(history.state) : toSnap;
      if (isHomeSnap(lastSnap)) ensureExitBuffer();
      restoring = false;
    });
  });

  const initial = parseHash() || emptySnap();
  restoring = true;
  pushSnap(initial, { replace: true });
  lastSnap = history.state ? normalizeSnap(history.state) : initial;
  if (isHomeSnap(lastSnap)) ensureExitBuffer();
  restoring = false;
}

export function isRestoringHistory() {
  return restoring;
}
