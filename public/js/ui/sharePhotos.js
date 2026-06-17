/**
 * sharePhotos.js — Condividi foto su app esterne (Web Share API + fallback download)
 */

import { tripDest } from '../utils.js';
import { t } from '../i18n.js';
import { zipSync } from '../vendor/fflate.esm.js';
import { fetchMe } from '../api.js';
import * as api from '../api.js';
import { exportPhotoBlob } from './photoDisplay.js';
import { getTripKey } from '../crypto/keyStore.js';
import { decryptPhoto, isEncryptedBytes } from '../crypto/photoCrypto.js';

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
    throw new Error(t('sharePhotos.fetchFail'));
  }
}

function pathsMatch(a, b) {
  try {
    return new URL(a, window.location.origin).pathname
      === new URL(b, window.location.origin).pathname;
  } catch {
    return a === b;
  }
}

/** True se l'img è già decodificata con successo (niente attese: lazy load o 401 bloccherebbero la share). */
function imgReady(img) {
  return img.complete && img.naturalWidth > 0;
}

/** Riutilizza immagini già caricate in galleria/lightbox (evita un fetch quando possibile). */
async function blobFromGalleryImage(url, photoId) {
  const sel = '#lbImg, .gal-grid img, .gal-hthumb img';
  for (const img of document.querySelectorAll(sel)) {
    const matchesId = photoId != null && img.dataset.photoId === String(photoId);
    const src = img.currentSrc || img.src;
    const matchesUrl = src && url && pathsMatch(src, url);
    if (!matchesId && !matchesUrl) continue;
    if (!imgReady(img)) continue;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (blob?.size) return blob;
    } catch {
      /* canvas tainted */
    }
  }
  return null;
}

/** Mobile / PWA: Web Share con file. Su desktop i ZIP danno NotAllowedError. */
export function isMobileShareDevice() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function tripIsOwner(trip) {
  return trip?.isOwner ?? (trip ? !trip.shared : false);
}

async function decryptFetchedBlob(blob, photo, trip) {
  if (!blob?.size) return blob;
  const head = new Uint8Array(await blob.slice(0, 6).arrayBuffer());
  if (!isEncryptedBytes(head)) return blob;
  const tripId = photo.tripId ?? trip?.id;
  const key = await getTripKey(tripId, { isOwner: tripIsOwner(trip) });
  if (!key) return null;
  const plain = await decryptPhoto(new Uint8Array(await blob.arrayBuffer()), key);
  const mime = photo.originalMime || photo.mime || 'image/jpeg';
  return new Blob([plain], { type: mime });
}

async function fetchPhotoBlobUrl(url, photo, trip) {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (res.status >= 500 && attempt < maxAttempts - 1) continue;
    if (res.status === 401) throw new Error(t('sharePhotos.sessionExpired'));
    if (res.status === 403) throw new Error(t('sharePhotos.emailRequired'));
    if (!res.ok) throw new Error(t('sharePhotos.fetchFail'));
    let blob = await res.blob();
    if (!blob.size) throw new Error(t('sharePhotos.fetchFail'));
    const ct = res.headers.get('content-type') || blob.type || '';
    if (ct.includes('application/json')) throw new Error(t('sharePhotos.fetchFail'));
    if (photo && trip) {
      const plain = await decryptFetchedBlob(blob, photo, trip);
      if (!plain?.size) throw new Error(t('sharePhotos.fetchFail'));
      blob = plain;
    }
    return blob;
  }
  throw new Error(t('sharePhotos.fetchFail'));
}

async function fetchPhotoBlob(photo, trip) {
  const tripId = photo.tripId ?? trip?.id;
  const mime = photo.originalMime || photo.mime || 'image/jpeg';
  const isOwner = tripIsOwner(trip);
  const encrypted = Boolean(photo?.encrypted);

  if (encrypted) {
    const fromDom = await blobFromGalleryImage(photo.url, photo.id);
    if (fromDom) return fromDom;

    const candidates = [];
    if (photo.url) candidates.push(photo.url);
    if (photo.id) candidates.push(`/api/photos/${photo.id}/file`);
    let lastErr;
    for (const candidate of candidates) {
      try {
        const blob = await exportPhotoBlob({
          tripId,
          photoId: photo.id,
          url: candidate,
          encrypted: true,
          mime,
          isOwner,
        });
        if (blob?.size) return blob;
      } catch {
        /* prova il prossimo candidato */
      }
    }
    for (const candidate of candidates) {
      try {
        return await fetchPhotoBlobUrl(candidate, photo, trip);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error(t('sharePhotos.fetchFail'));
  }

  const url = photo?.url;
  if (url) {
    const fromDom = await blobFromGalleryImage(url, photo.id);
    if (fromDom) return fromDom;
  }

  const candidates = [];
  if (url) candidates.push(url);
  if (photo?.id) candidates.push(`/api/photos/${photo.id}/file`);

  let lastErr;
  for (const candidate of candidates) {
    try {
      return await fetchPhotoBlobUrl(candidate, photo, trip);
    } catch (err) {
      lastErr = err;
      if (err.message === t('sharePhotos.sessionExpired')) {
        try {
          await fetchMe();
          return await fetchPhotoBlobUrl(candidate, photo, trip);
        } catch {
          throw err;
        }
      }
    }
  }

  throw lastErr || new Error(t('sharePhotos.fetchFail'));
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
  if (!photos?.length) await ensureSession();
  const list = (photos?.length ? photos : await api.fetchPhotos(trip.id, { fresh: true })).filter(p => p.url);
  if (!list.length) throw new Error(t('gal.noPhotos'));

  onProgress?.(0, list.length);
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
