/**
 * sharePhotos.js — Condividi foto su app esterne (Web Share API + fallback download)
 */

import { tripDest, esc } from '../utils.js';
import { t } from '../i18n.js';
import { zipSync } from '../vendor/fflate.esm.js';
import { fetchMe } from '../api.js';
import * as api from '../api.js';
import { awaitPlainBlob } from './photoDisplay.js';
import { openModal, closeModal } from './modal.js';
import { showToast } from './toast.js';

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

function blobToFile(blob, photo, trip, index) {
  const mime = photo.originalMime || photo.mime || null;
  const enc = Boolean(photo.encrypted);
  const ext = enc ? (EXT_BY_MIME[mime] || 'jpg') : extFromUrl(photo.url);
  const type = blob.type?.startsWith('image/') ? blob.type : (mime || MIME_BY_EXT[ext] || 'image/jpeg');
  const name = `${safeBaseName(trip)}_${String(index + 1).padStart(2, '0')}.${ext}`;
  return new File([blob], name, { type, lastModified: Date.now() });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function raceTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const PHOTO_EXPORT_MS = 35000;

async function photoToFile(photo, trip, index, { isCancelled } = {}) {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (isCancelled?.()) return null;
    if (attempt > 0) await sleep(800);
    try {
      const blob = await raceTimeout(
        awaitPlainBlob(photo, trip, { maxAttempts: 2 }),
        PHOTO_EXPORT_MS,
      );
      if (blob?.size) return blobToFile(blob, photo, trip, index);
    } catch {
      /* timeout o errore di rete: ritenta o salta */
    }
  }
  return null;
}

export async function buildPhotoFiles(photos, trip, { onProgress, isCancelled } = {}) {
  const list = photos.filter(p => p.url);
  const files = [];
  let skipped = 0;
  const gapMs = isMobileShareDevice() ? 400 : 120;

  for (let i = 0; i < list.length; i++) {
    if (isCancelled?.()) break;
    const file = await photoToFile(list[i], trip, i, { isCancelled });
    if (file) files.push(file);
    else skipped += 1;
    onProgress?.(i + 1, list.length);
    if (isCancelled?.()) break;
    if (i < list.length - 1) await sleep(gapMs);
  }

  return { files, skipped };
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
    return false;
  }
  try {
    await navigator.share({ files });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return true;
    throw err;
  }
}

function openExportProgress(trip, total) {
  let cancelled = false;
  const body = document.createElement('div');
  body.className = 'modal-body share-export-progress';
  body.innerHTML = `
    <p class="share-export-hint">${esc(t('sharePhotos.hint'))}</p>
    <div class="share-export-status">${esc(t('sharePhotos.preparing'))}</div>
    <div class="share-export-track">
      <div class="share-export-bar"></div>
    </div>
    <button type="button" class="modal-btn s" id="shareExportCancel">${esc(t('modal.cancel'))}</button>`;

  body.querySelector('#shareExportCancel').addEventListener('click', () => {
    cancelled = true;
    closeModal();
  });

  openModal({
    title: total > 1 ? t('sharePhotos.titleAlbum', { n: total }) : t('sharePhotos.titleSingle'),
    body,
    onClose: () => { cancelled = true; },
  });

  const status = body.querySelector('.share-export-status');
  const bar = body.querySelector('.share-export-bar');

  return {
    isCancelled: () => cancelled,
    update(done, tot) {
      status.textContent = t('sharePhotos.preparingN', { done, total: tot });
      bar.style.width = `${Math.round((done / tot) * 100)}%`;
    },
    close() {
      closeModal();
    },
  };
}

async function resolvePhotoList(trip, photos) {
  await ensureSession();
  const list = (photosForTrip(trip, photos) || await api.fetchPhotos(trip.id, { fresh: true }))
    .filter(p => p.url);
  if (!list.length) throw new Error(t('gal.noPhotos'));
  return list;
}

async function buildAlbumExportFiles(trip, { onProgress, photos, isCancelled } = {}) {
  const list = await resolvePhotoList(trip, photos);
  onProgress?.(0, list.length);
  return buildPhotoFiles(list, trip, { onProgress, isCancelled });
}

async function buildAlbumExportFile(trip, opts = {}) {
  const { files, skipped } = await buildAlbumExportFiles(trip, opts);
  if (!files.length) throw new Error(t('sharePhotos.fetchFail'));
  if (skipped > 0) {
    showToast(t('sharePhotos.partialSkipped', { n: skipped, ok: files.length }), 'neutral');
  }
  if (files.length === 1) return files[0];
  opts.onProgress?.(files.length, files.length);
  return buildZipFile(files, trip);
}

async function deliverAlbumShare(files, trip) {
  if (files.length === 1) {
    await shareFile(files[0]);
    return;
  }

  if (isMobileShareDevice()) {
    const shared = await shareFiles(files);
    if (shared) return;

    const zip = await buildZipFile(files, trip);
    if (!navigator.canShare || navigator.canShare({ files: [zip] })) {
      try {
        await navigator.share({ files: [zip] });
        return;
      } catch (err) {
        if (err?.name === 'AbortError') return;
      }
    }
    downloadFiles([zip]);
    showToast(t('sharePhotos.downloadFallback'), 'neutral');
    return;
  }

  await shareFile(await buildZipFile(files, trip));
}

/**
 * Scarica l'album come ZIP (solo desktop).
 */
export async function downloadAlbumAsZip(trip, opts = {}) {
  const progress = openExportProgress(trip, trip.photoCount || 0);
  try {
    const file = await buildAlbumExportFile(trip, {
      ...opts,
      isCancelled: () => progress.isCancelled(),
      onProgress: (done, total) => {
        if (progress.isCancelled()) throw new Error('cancel');
        progress.update(done, total);
      },
    });
    progress.close();
    downloadFiles([file]);
    showToast(t('sharePhotos.downloadedZip'), 'neutral');
  } catch (e) {
    progress.close();
    if (e.message !== 'cancel') throw e;
  }
}

/**
 * Condivide l'album via foglio nativo (mobile / PWA).
 */
export async function shareAlbum(trip, opts = {}) {
  const list = await resolvePhotoList(trip, opts.photos);
  const progress = openExportProgress(trip, list.length);
  try {
    const { files, skipped } = await buildPhotoFiles(list, trip, {
      isCancelled: () => progress.isCancelled(),
      onProgress: (done, total) => {
        if (progress.isCancelled()) throw new Error('cancel');
        progress.update(done, total);
      },
    });
    if (progress.isCancelled()) return;
    progress.close();
    if (!files.length) throw new Error(t('sharePhotos.fetchFail'));
    if (skipped > 0) {
      showToast(t('sharePhotos.partialSkipped', { n: skipped, ok: files.length }), 'neutral');
    }
    await deliverAlbumShare(files, trip);
  } catch (e) {
    progress.close();
    if (e.message === 'cancel') return;
    throw e;
  }
}

/** Condivide una singola foto via foglio nativo (mobile / PWA). */
export async function shareSinglePhoto(trip, photo) {
  await ensureSession();
  if (!photo?.url) throw new Error(t('sharePhotos.fetchFail'));
  const file = await photoToFile(photo, trip, 0);
  if (!file) throw new Error(t('sharePhotos.fetchFail'));
  await shareFile(file);
}

/** Scarica una singola foto (desktop). */
export async function downloadSinglePhoto(trip, photo) {
  await ensureSession();
  if (!photo?.url) throw new Error(t('sharePhotos.fetchFail'));
  const file = await photoToFile(photo, trip, 0);
  if (!file) throw new Error(t('sharePhotos.fetchFail'));
  downloadFiles([file]);
  showToast(t('sharePhotos.downloaded', { n: 1 }), 'neutral');
}
