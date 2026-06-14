/**
 * journeyList.js — Lista «Tutte le tappe» (home + mappa)
 */

import { esc, joinParts, monthYear, tripDest, mountPhotoEmptyThumb } from '../utils.js';
import { t } from '../i18n.js';
import { refreshJourneyScroll } from '../ui/journeyScroll.js';

/**
 * @param {HTMLElement} listEl
 * @param {object[]} trips
 * @param {{ onTripClick?: (trip: object, index: number) => void, emptyHtml?: string }} opts
 */
export function renderJourneyList(listEl, trips, { onTripClick, emptyHtml } = {}) {
  if (!listEl) return;
  listEl.innerHTML = '';

  if (!trips.length) {
    listEl.innerHTML = emptyHtml ?? `<div class="search-noresults">${t('search.empty')}</div>`;
    refreshJourneyScroll(listEl);
    return;
  }

  trips.forEach((trip, i) => {
    const row = document.createElement('div');
    row.className = 'journey-row';

    const thumb = document.createElement('div');
    thumb.className = 'journey-thumb';
    if (trip.coverUrl) {
      const img = document.createElement('img');
      img.src = trip.coverUrl;
      img.alt = trip.dest;
      img.loading = 'lazy';
      thumb.appendChild(img);
    } else {
      mountPhotoEmptyThumb(thumb);
    }
    row.appendChild(thumb);

    const tags = (trip.tags || []).slice(0, 3);
    row.insertAdjacentHTML('beforeend', `
      <div class="journey-sel-bar"></div>
      <div class="journey-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="journey-info">
        <div class="journey-dest"><span class="journey-dest-txt">${esc(tripDest(trip))}</span>${trip.shared ? `<span class="trip-shared-badge">${esc(t('gal.sharedBadge'))}</span>` : ''}</div>
        <div class="journey-meta">${esc(joinParts(trip.country, monthYear(trip)))}</div>
        ${tags.length ? `<div class="journey-tags">${tags.map((g, j) => `<span class="jtag${j === 0 ? ' hi' : ''}">${esc(g)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="journey-right">
        <div class="journey-stat">
          <div class="journey-stat-v">${trip.days ?? '—'}</div>
          <div class="journey-stat-l">${t('unit.daysShort')}</div>
        </div>
        <div class="journey-stat">
          <div class="journey-stat-v">${trip.photoCount || 0}</div>
          <div class="journey-stat-l">${t('unit.photosShort')}</div>
        </div>
      </div>`);

    if (onTripClick) row.onclick = () => onTripClick(trip, i);
    listEl.appendChild(row);
  });

  refreshJourneyScroll(listEl);
}
