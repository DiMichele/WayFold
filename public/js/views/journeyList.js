/**
 * journeyList.js — Lista «Tutte le tappe» (home + mappa)
 */

import { esc, joinParts, monthYear, tripDest, tripCountry, mountPhotoEmptyThumb, isEvent } from '../utils.js';
import { t } from '../i18n.js';
import { refreshJourneyScroll } from '../ui/journeyScroll.js';
import { mountCover } from '../ui/photoDisplay.js';

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
      img.alt = trip.dest;
      img.loading = 'lazy';
      mountCover(img, trip);
      thumb.appendChild(img);
    } else {
      mountPhotoEmptyThumb(thumb);
    }
    row.appendChild(thumb);

    const event = isEvent(trip);
    const tags = event ? [] : (trip.tags || []).slice(0, 3);
    row.insertAdjacentHTML('beforeend', `
      <div class="journey-sel-bar"></div>
      <div class="journey-num">${String(i + 1).padStart(2, '0')}</div>
      <div class="journey-info">
        <div class="journey-dest"><span class="journey-dest-txt">${esc(tripDest(trip))}</span>${event ? `<span class="trip-event-badge">${esc(t('kind.event'))}</span>` : ''}${trip.shared ? `<span class="trip-shared-badge">${esc(t('gal.sharedBadge'))}</span>` : ''}</div>
        <div class="journey-meta">${esc(event ? joinParts(monthYear(trip), t('kind.eventMeta')) : joinParts(tripCountry(trip), monthYear(trip)))}</div>
        ${tags.length ? `<div class="journey-tags">${tags.map((g, j) => `<span class="jtag${j === 0 ? ' hi' : ''}">${esc(g)}</span>`).join('')}</div>` : ''}
      </div>
      <div class="journey-right">
        ${event ? '' : `<div class="journey-stat">
          <div class="journey-stat-v">${trip.days ?? '—'}</div>
          <div class="journey-stat-l">${t('unit.daysShort')}</div>
        </div>`}
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
