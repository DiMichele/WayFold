/**
 * router.js — Navigazione tra le viste
 */

import { state } from './state.js';
import { renderRoad } from './views/road.js';
import { renderGallery } from './views/gallery.js';
import { renderMap } from './views/map.js';
import { renderAccount } from './views/account.js';
import { refreshJourneyScrollsInView } from './ui/journeyScroll.js';

export function switchView(name) {
  if (state.syncBlocked) return;
  state.view = name;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById('view-' + name);
  view.classList.add('active');
  // Riavvia l'animazione di ingresso della vista
  view.classList.remove('entering');
  void view.offsetWidth;
  view.classList.add('entering');
  document.querySelectorAll('.tab, .side-link').forEach(b =>
    b.classList.toggle('on', b.dataset.v === name)
  );
  window.scrollTo({ top: 0, behavior: 'instant' });
  renderCurrentView();
  refreshJourneyScrollsInView(name);
}

export function renderCurrentView() {
  if (state.view === 'road') renderRoad();
  if (state.view === 'gallery') renderGallery();
  if (state.view === 'map') renderMap();
  if (state.view === 'account') renderAccount();
}
