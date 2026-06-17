/**
 * sharePhotos.js — Condividi foto su app esterne (Web Share API + fallback download)
 */

import { tripDest } from '../utils.js';
import { t } from '../i18n.js';
import { zipSync } from '../vendor/fflate.esm.js';
import { fetchMe } from '../api.js';
import * as api from '../api.js';
import { loadPhotoForShare, prefetchPhotosForExport } from './photoDisplay.js';
import { getTripKey } from '../crypto/keyStore.js';

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heic',
};

function extFromUrl(url) {
  const m = String(url || '').match(/\.([a-z0-9]+)(?:\?|$)/i);
  const ext = m?.[1]?.toLowerCase();
  return ['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext) ? ext.replace('jpeg', 'jpg') : 'jpg';
}

function safeBaseName(trip) {
  return String(tripDest(trip) || 'wayfold')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 40) || 'wayfold';
}

async function ensureSession() {
  try {
    await fetchMe();
  } catch (err) {
    if (err.status === 401) throw new Error(t('sharePhotos.sessionExpired'));
    throw err;
  }
}

function photosForTrip(trip, photos) {
  if (!photos?.length || !trip?.id) return null;
  const tripId = Number(trip.id);
  if (photos[0]?.tripId != null && Number(photos[0].tripId) !== tripId) return null;
  return photos;
}

/** Mobile / PWA: Web Share con file. Su desktop i ZIP danno NotAllowedError. */
export function isMobileShareDevice() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function fetchPhotoBlob(photo, trip) {
  const blob = await loadPhotoForShare(photo, trip);
  if (blob?.size) return blob;
  throw new Error(t('sharePhotos.fetchFail'));
}

async function photoToFile(photo, trip, index) {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 450 * attempt));
    try {
      const blob = await fetchPhotoBlob(photo, trip);
      const mime = photo.originalMime || photo.mime || null;
      const enc = Boolean(photo.encrypted);
      const ext = enc ? (EXT_BY_MIME[mime] || 'jpg') : extFromUrl(photo.url);
      const type = blob.type?.startsWith('image/') ? blob.type : (mime || MIME_BY_EXT[ext] || 'image/jpeg');
      const name = `${safeBaseName(trip)}_${String(index + 1).padStart(2, '0')}.${ext}`;
      return new File([blob], name, { type, lastModified: Date.now() });
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(t('sharePhotos.fetchFail'));
}

export async function buildPhotoFiles(photos, trip, { onProgress } = {}) {
  const list = photos.filter(p => p.url);
  const files = [];
  for (let i = 0; i < list.length; i++) {
    onProgress?.(i + 1, list.length);
    files.push(await photoToFile(list[i], trip, i));
  }
  return files;
}

async function buildZipFile(files, trip) {
  const entries = {};
  for (const file of files) {
    entries[file.name] = new Uint8Array(await file.arrayBuffer());
  }
  const zipped = zipSync(entries, { level: 0 });
  const zipName = `${safeBaseName(trip)}.zip`;
  return new File([zipped], zipName, { type: 'application/zip', lastModified: Date.now() });
}

function downloadFiles(files) {
  const file = files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function shareFile(file) {
  if (!navigator.share) throw new Error(t('sharePhotos.noWebShare'));
  if (navigator.canShare && !navigator.canShare({ files: [file] })) {
    throw new Error(t('sharePhotos.cantShareFiles', { n: 1 }));
  }
  try {
    await navigator.share({ files: [file] });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    throw err;
  }
}

async function shareFiles(files) {
  if (!navigator.share) throw new Error(t('sharePhotos.noWebShare'));
  if (navigator.canShare && !navigator.canShare({ files })) {
    throw new Error(t('sharePhotos.cantShareFiles', { n: files.length }));
  }
  try {
    await navigator.share({ files });
  } catch (err) {
    if (err?.name === 'AbortError') return;
    throw err;
  }
}

async function buildAlbumExportFiles(trip, { onProgress, photos } = {}) {
  await ensureSession();
  const cached = photosForTrip(trip, photos);
  const list = (cached || await api.fetchPhotos(trip.id, { fresh: true })).filter(p => p.url);
  if (!list.length) throw new Error(t('gal.noPhotos'));

  const tripId = Number(trip.id);
  const key = await getTripKey(tripId, { isOwner: false });
  if (!key && list.some(p => p.encrypted)) {
    throw new Error(t('sharePhotos.fetchFail'));
  }

  onProgress?.(0, list.length);
  await prefetchPhotosForExport(list, trip);
  const files = await buildPhotoFiles(list, trip, onProgress);
  return files;
}

async function buildAlbumExportFile(trip, opts = {}) {
  const files = await buildAlbumExportFiles(trip, opts);
  if (files.length === 1) return files[0];

  opts.onProgress?.(files.length, files.length);
  return buildZipFile(files, trip);
}

/**
 * Scarica l'album come ZIP (solo desktop).
 */
export async function downloadAlbumAsZip(trip, opts = {}) {
  const file = await buildAlbumExportFile(trip, opts);
  downloadFiles([file]);
}

/**
 * Condivide l'album via foglio nativo (mobile / PWA).
 */
export async function shareAlbum(trip, opts = {}) {
  const files = await buildAlbumExportFiles(trip, opts);
  if (files.length === 1) {
    await shareFile(files[0]);
    return;
  }
  if (isMobileShareDevice()) {
    await shareFiles(files);
    return;
  }
  await shareFile(await buildZipFile(files, trip));
}

/** Scarica o condivide una singola foto (lightbox). */
async function buildSinglePhotoFile(trip, photo) {
  await ensureSession();
  if (!photo?.url) throw new Error(t('sharePhotos.fetchFail'));
  return photoToFile(photo, trip, 0);
}

/** Condivide una singola foto via foglio nativo (mobile / PWA). */
export async function shareSinglePhoto(trip, photo) {
  const file = await buildSinglePhotoFile(trip, photo);
  await shareFile(file);
}

/** Scarica una singola foto (desktop). */
export async function downloadSinglePhoto(trip, photo) {
  const file = await buildSinglePhotoFile(trip, photo);
  downloadFiles([file]);
}
