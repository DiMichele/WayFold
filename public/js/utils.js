/**
 * utils.js — Piccole utility condivise
 */

import { displayMonth, getMonthLabels, getMonthValues } from './i18n.js';

export const MONTHS = getMonthValues();

/** Unisce parti di testo saltando i valori vuoti: joinParts('a', null, 'b') → "a · b" */
export function joinParts(...parts) {
  return parts.filter(p => p !== null && p !== undefined && p !== '').join(' · ');
}

/** "Set 2024", oppure solo anno/mese se l'altro manca */
export function monthYear(trip) {
  const m = trip.month ? displayMonth(trip.month) : null;
  return [m, trip.year].filter(Boolean).join(' ');
}

/** Timestamp Unix (secondi) o ISO → "14 Set 2024" */
export function formatPhotoDate(unixSecondsOrIso) {
  if (!unixSecondsOrIso) return '';
  const d = typeof unixSecondsOrIso === 'string'
    ? new Date(unixSecondsOrIso)
    : new Date(unixSecondsOrIso * 1000);
  if (Number.isNaN(d.getTime())) return '';
  const months = getMonthLabels();
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Data migliore disponibile per una foto dall'API */
export function photoDisplayDate(photo) {
  return formatPhotoDate(photo.takenAt || photo.date);
}

/** Escape HTML per testo inserito via innerHTML */
export function esc(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

/** Nome viaggio senza prefisso Telegram "[username]". */
export function tripDest(trip) {
  return String(trip?.dest ?? trip?.name ?? '')
    .trim()
    .replace(/^\[[a-zA-Z0-9_.]{3,20}\]\s*/, '');
}

/** Icona album vuoto (galleria / upload). */
export const PHOTO_EMPTY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.5" y="6" width="15" height="12" rx="2"/><circle cx="9.25" cy="10.25" r="1.25"/><path d="m6.5 16.5 3.5-3.5 2.25 2.25L14 12l3.5 4.5"/></svg>';

export function mountPhotoEmptyThumb(container) {
  const node = document.createElement('div');
  node.className = 'thumb-empty';
  node.innerHTML = `<span class="thumb-empty-ico" aria-hidden="true">${PHOTO_EMPTY_SVG}</span>`;
  container.appendChild(node);
}
