/**
 * ui/palette.js — Command palette (Ctrl+K / "/")
 *
 * Ricerca istantanea su viaggi (nome, paese, anno, tag, tipo) + azioni rapide.
 * Navigazione completa da tastiera: ↑↓ per muoversi, Invio per aprire, Esc per chiudere.
 */

import { state } from '../state.js';
import { switchView } from '../router.js';
import { goToGallery } from '../historyNav.js';
import { reloadTrips } from '../data.js';
import { openTripForm } from './modal.js';
import { joinParts, monthYear, esc } from '../utils.js';
import { mountCover } from './photoDisplay.js';
import { t, formatPhotos } from '../i18n.js';
import { pushOverlay, notifyOverlayClosed, isRestoringHistory } from '../historyNav.js';

const el = id => document.getElementById(id);

let _items = [];   // elementi navigabili correnti [{ type, trip?, action?, label }]
let _active = 0;

export function initPalette() {
  const overlay = el('palette');
  const input = el('paletteInput');

  el('searchToggle').addEventListener('click', openPalette);
  el('paletteClose').addEventListener('click', closePalette);
  el('paletteForm')?.addEventListener('submit', e => e.preventDefault());
  overlay.addEventListener('click', e => {
    if (!e.target.closest('.pal-card')) closePalette();
  });

  document.addEventListener('keydown', e => {
    const isOpen = overlay.classList.contains('open');
    const inField = /^(input|textarea|select)$/i.test(document.activeElement?.tagName || '');

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      isOpen ? closePalette() : openPalette();
      return;
    }
    if (!isOpen && e.key === '/' && !inField) {
      e.preventDefault();
      openPalette();
      return;
    }
    if (!isOpen) return;

    if (e.key === 'Escape') { closePalette(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    if (e.key === 'Enter') { e.preventDefault(); pick(_active); }
  });

  let debounce = null;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderResults(input.value), 80);
  });

  window.addEventListener('wf:langchange', () => {
    if (overlay.classList.contains('open')) renderResults(input.value);
  });
}

export function isPaletteOpen() {
  return el('palette').classList.contains('open');
}

export function openPalette() {
  if (state.syncBlocked) return;
  const input = el('paletteInput');
  el('palette').classList.add('open');
  input.value = '';
  input.readOnly = true;
  renderResults('');
  setTimeout(() => {
    input.readOnly = false;
    input.value = '';
    input.focus({ preventScroll: true });
    renderResults('');
  }, 60);
  if (!isRestoringHistory()) pushOverlay('palette');
}

export function closePalette(fromHistory = false) {
  if (!isPaletteOpen()) return;
  el('palette').classList.remove('open');
  el('paletteInput').blur();
  if (!fromHistory) notifyOverlayClosed();
}

// ─── Matching ──────────────────────────────────────────────────────────────

function score(trip, q) {
  if (!q) return 1;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [
    trip.dest, trip.name, trip.country, trip.continent, trip.type,
    trip.year != null ? String(trip.year) : '',
    ...(trip.tags || []),
  ].join(' ').toLowerCase();

  let s = 0;
  for (const tok of tokens) {
    if (!hay.includes(tok)) return 0;        // tutti i token devono comparire
    if (trip.dest?.toLowerCase().startsWith(tok)) s += 3;
    else if (hay.startsWith(tok)) s += 2;
    else s += 1;
  }
  return s;
}

function highlight(text, q) {
  if (!q) return esc(text);
  const safe = esc(text);
  const tokens = q.trim().split(/\s+/).filter(Boolean)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!tokens.length) return safe;
  return safe.replace(new RegExp(`(${tokens.join('|')})`, 'gi'), '<mark>$1</mark>');
}

// ─── Render ────────────────────────────────────────────────────────────────

function renderResults(q) {
  const list = el('paletteResults');
  const query = q.trim();
  _items = [];
  _active = 0;

  const matches = state.trips
    .map(t => ({ t, s: score(t, query) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.t.year ?? 0) - (a.t.year ?? 0))
    .slice(0, 8);

  let html = '';

  if (matches.length) {
    html += `<div class="pal-group">${t('palette.trips')}</div>`;
    matches.forEach(({ t }) => {
      const i = _items.length;
      _items.push({ type: 'trip', trip: t });
      html += `
        <div class="pal-row" data-i="${i}">
          <div class="pal-thumb">${t.coverUrl
            ? `<img alt="" loading="lazy" data-cover="${i}">`
            : `<span class="pal-thumb-flag">${t.flag || '·'}</span>`}</div>
          <div class="pal-info">
            <div class="pal-dest">${highlight(t.dest, query)}</div>
            <div class="pal-meta">${esc(joinParts(t.country, monthYear(t), formatPhotos(t.photoCount || 0)))}</div>
          </div>
          <span class="pal-year">${t.year ?? ''}</span>
        </div>`;
    });
  } else if (query) {
    const q = esc(query);
    html += `<div class="pal-none">${t('palette.noResults', { q }).replace(q, `<b>${q}</b>`)}</div>`;
  }

  html += `<div class="pal-group">${t('palette.actions')}</div>`;
  const actions = [
    { label: t('palette.newTrip'), icon: 'M12 5v14M5 12h14', run: () => openTripForm({ onSaved: () => reloadTrips() }) },
    { label: t('palette.newEvent'), icon: 'M8 2v4M16 2v4M3 4h18v18H3zM3 10h18', run: () => openTripForm({ kind: 'event', onSaved: () => reloadTrips() }) },
    { label: t('palette.openMap'), icon: 'M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4', run: () => switchView('map') },
    { label: t('palette.goRoad'), icon: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8 M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', run: () => switchView('road') },
  ].filter(a => !query || a.label.toLowerCase().includes(query.toLowerCase()));

  actions.forEach(a => {
    const i = _items.length;
    _items.push({ type: 'action', run: a.run });
    html += `
      <div class="pal-row pal-action" data-i="${i}">
        <div class="pal-thumb pal-thumb-ico"><svg viewBox="0 0 24 24"><path d="${a.icon}"/></svg></div>
        <div class="pal-info"><div class="pal-dest">${esc(a.label)}</div></div>
        <span class="pal-kbd">↵</span>
      </div>`;
  });

  list.innerHTML = html;

  // Copertine: decifrate al volo per i viaggi cifrati
  list.querySelectorAll('img[data-cover]').forEach(img => {
    const item = _items[Number(img.dataset.cover)];
    if (item?.trip) mountCover(img, item.trip);
  });

  paintActive();

  list.querySelectorAll('.pal-row').forEach(row => {
    row.addEventListener('click', () => pick(Number(row.dataset.i)));
    row.addEventListener('mousemove', () => {
      const i = Number(row.dataset.i);
      if (i !== _active) { _active = i; paintActive(); }
    });
  });
}

function move(dir) {
  if (!_items.length) return;
  _active = (_active + dir + _items.length) % _items.length;
  paintActive();
}

function paintActive() {
  el('paletteResults').querySelectorAll('.pal-row').forEach(row => {
    const on = Number(row.dataset.i) === _active;
    row.classList.toggle('on', on);
    if (on) row.scrollIntoView({ block: 'nearest' });
  });
}

function pick(i) {
  const item = _items[i];
  if (!item) return;
  closePalette();
  if (item.type === 'trip') {
    goToGallery(item.trip.id);
  } else {
    item.run();
  }
}
