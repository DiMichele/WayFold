/**
 * views/road.js — Vista principale: hero, KPI, timeline, archivio, detail box
 */

import { state, getTrip, visibleTrips } from '../state.js';
import { joinParts, monthYear, esc, tripDest, mountPhotoEmptyThumb } from '../utils.js';
import { switchView } from '../router.js';
import { reloadTrips } from '../data.js';
import { openTripForm } from '../ui/modal.js';
import { confirmDeleteTrip } from '../ui/tripDelete.js';
import { renderJourneyList } from './journeyList.js';
import { t, displayTripType, formatDays, formatPhotos } from '../i18n.js';

const el = id => document.getElementById(id);

// ─── Init (handler statici, una volta sola) ────────────────────────────────

export function initRoad() {
  el('heroEl').addEventListener('click', () => {
    const trip = state.trips[state.heroIdx];
    if (!trip) return;
    state.galTripId = trip.id;
    switchView('gallery');
  });

  el('heroPrev').addEventListener('click', e => {
    e.stopPropagation();
    navigateHero(-1);
  });
  el('heroNext').addEventListener('click', e => {
    e.stopPropagation();
    navigateHero(1);
  });

  el('dboxClose').addEventListener('click', () => {
    state.selTripId = null;
    el('detailBox').classList.remove('open');
    buildJourneyList();
  });

  el('dboxGal').addEventListener('click', () => {
    if (state.selTripId === null) return;
    state.galTripId = state.selTripId;
    switchView('gallery');
  });

  el('dboxMap').addEventListener('click', () => switchView('map'));

  el('dboxEdit').addEventListener('click', () => {
    const t = getTrip(state.selTripId);
    if (!t) return;
    openTripForm({ trip: t, onSaved: () => reloadTrips() });
  });

  el('dboxDelete').addEventListener('click', () => {
    const trip = getTrip(state.selTripId);
    if (!trip) return;
    confirmDeleteTrip(trip, {
      onDeleted: () => {
        state.selTripId = null;
        el('detailBox').classList.remove('open');
      },
    });
  });
}

// ─── Render ────────────────────────────────────────────────────────────────

export function renderRoad() {
  const hasTrips = state.trips.length > 0;
  el('roadContent').hidden = !hasTrips;
  el('roadEmpty').hidden = hasTrips;
  if (!hasTrips) return;

  buildHero();
  buildKPI();
  buildTimeline();
  buildJourneyList();
  syncDetailBox();
}

// ─── Hero ──────────────────────────────────────────────────────────────────

function navigateHero(delta) {
  const n = state.trips.length;
  if (n <= 1) return;
  state.heroIdx = (state.heroIdx + delta + n) % n;
  buildHero();
  buildTimeline();
}

function updateHeroNav() {
  const show = state.trips.length > 1;
  el('heroPrev').hidden = !show;
  el('heroNext').hidden = !show;
}

function buildHero() {
  const trip = state.trips[state.heroIdx];
  if (!trip) return;

  const photo = el('heroPhoto');
  const empty = el('heroEmpty');
  const heroEl = el('heroEl');

  if (trip.coverUrl) {
    heroEl.classList.remove('hero--empty');
    el('heroCv').hidden = true;
    empty.hidden = true;
    empty.innerHTML = '';
    photo.src = trip.coverUrl;
    photo.classList.add('show');
  } else {
    heroEl.classList.add('hero--empty');
    el('heroCv').hidden = true;
    photo.classList.remove('show');
    photo.removeAttribute('src');
    empty.hidden = false;
    empty.innerHTML = '';
    mountPhotoEmptyThumb(empty);
  }

  updateHeroNav();

  el('heroEyebrow').textContent =
    state.heroIdx === state.trips.length - 1
      ? t('hero.lastTrip')
      : (displayTripType(trip.type) || trip.continent || t('hero.trip'));
  el('heroTitle').textContent = tripDest(trip);
  el('heroDetail').textContent = joinParts(
    trip.country,
    monthYear(trip),
    trip.days ? formatDays(trip.days) : null,
    formatPhotos(trip.photoCount || 0)
  );

  buildPips();
}

function buildPips() {
  const c = el('heroPips');
  c.innerHTML = '';
  state.trips.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'pip' + (i === state.heroIdx ? ' on' : '');
    d.onclick = e => { e.stopPropagation(); state.heroIdx = i; buildHero(); buildTimeline(); };
    c.appendChild(d);
  });
}

// ─── KPI ───────────────────────────────────────────────────────────────────

/** Contatore animato: il numero "scorre" fino al valore finale. */
function countUp(node, target) {
  const to = Number(target);
  if (!Number.isFinite(to) || to <= 0) { node.textContent = target; return; }
  const dur = 700;
  const t0 = performance.now();
  const step = now => {
    const p = Math.min(1, (now - t0) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = Math.round(to * eased);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function buildKPI() {
  const trips = state.trips;
  const countries = new Set(trips.map(t => t.country).filter(Boolean));
  const continents = new Set(trips.map(t => t.continent).filter(Boolean));
  const photos = trips.reduce((n, t) => n + (t.photoCount || 0), 0);
  const thisYear = new Date().getFullYear();
  const recent = trips.filter(t => (t.year ?? 0) >= thisYear - 1).length;

  countUp(el('kpiT'), trips.length);
  el('kpiTSub').textContent = recent > 0 ? t('kpi.recent', { n: recent }) : '—';
  countries.size ? countUp(el('kpiC'), countries.size) : el('kpiC').textContent = '—';
  el('kpiCSub').textContent = [...continents].slice(0, 2).join(' · ') || t('kpi.awaitMap');
  continents.size ? countUp(el('kpiCont'), continents.size) : el('kpiCont').textContent = '—';
  el('kpiContSub').textContent = [...continents].join(', ').slice(0, 18) || '—';
  countUp(el('kpiP'), photos);
  const withPhotos = trips.filter(tr => (tr.photoCount || 0) > 0).length;
  el('kpiPSub').textContent = withPhotos > 0 ? t('kpi.inTrips', { n: withPhotos }) : '—';
}

// ─── Timeline ──────────────────────────────────────────────────────────────

function buildTimeline() {
  const sc = el('tlScroll');
  sc.querySelectorAll('.tl-node').forEach(e => e.remove());
  state.trips.forEach((t, i) => {
    const node = document.createElement('div');
    node.className = 'tl-node' + (i === state.heroIdx ? ' on' : '');
    node.innerHTML = `
      <div class="tl-ring"><div class="tl-dot"></div></div>
      <div class="tl-year">${esc(t.year ?? '—')}</div>
      <div class="tl-place">${esc(t.dest)}</div>`;
    node.onclick = () => { state.heroIdx = i; buildHero(); buildTimeline(); };
    sc.appendChild(node);
  });
  const active = sc.querySelectorAll('.tl-node')[state.heroIdx];
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

  const axis = sc.querySelector('.tl-axis');
  if (axis) axis.style.width = `${sc.scrollWidth}px`;
}

// ─── Lista destinazioni ────────────────────────────────────────────────────

function buildJourneyList() {
  const trips = visibleTrips();
  const q = esc(state.search);
  renderJourneyList(el('journeyList'), trips, {
    emptyHtml: trips.length
      ? undefined
      : `<div class="search-noresults">${t('search.none', { q }).replace(q, `<b>${q}</b>`)}</div>`,
    onTripClick: trip => {
      const idx = state.trips.findIndex(tr => tr.id === trip.id);
      if (idx >= 0) state.heroIdx = idx;
      state.galTripId = trip.id;
      switchView('gallery');
    },
  });
}

// ─── Detail box ────────────────────────────────────────────────────────────

function openDetail(trip) {
  const box = el('detailBox');
  el('dboxTitle').textContent = tripDest(trip);
  el('dboxWhere').textContent = joinParts(trip.country, monthYear(trip)) || '—';
  el('dboxD').textContent = trip.days ?? '—';
  el('dboxP').textContent = trip.photoCount ?? 0;
  el('dboxType').textContent = trip.type ? displayTripType(trip.type).slice(0, 8) : '—';
  box.classList.add('open');

  requestAnimationFrame(() => {
    const cv = el('dboxCv');
    const photo = el('dboxPhoto');
    const empty = el('dboxEmpty');

    if (trip.coverUrl) {
      cv.hidden = true;
      empty.hidden = true;
      photo.src = trip.coverUrl;
      photo.style.display = '';
    } else {
      cv.hidden = true;
      photo.style.display = 'none';
      photo.removeAttribute('src');
      empty.hidden = false;
    }
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

/** Dopo un refresh dati, riallinea il detail box (viaggio sparito → chiudi). */
function syncDetailBox() {
  const t = getTrip(state.selTripId);
  if (!t) {
    state.selTripId = null;
    el('detailBox').classList.remove('open');
  } else {
    openDetail(t);
  }
}
