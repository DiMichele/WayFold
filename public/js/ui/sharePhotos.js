/**
 * sharePhotos.js — Condividi foto su app esterne (Web Share API + fallback download)
 */

import { tripDest } from '../utils.js';
import { t } from '../i18n.js';
import { zipSync } from '../vendor/fflate.esm.js';
import { fetchMe } from '../api.js';
import * as api from '../api.js';

const MIME_BY_EXT = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

/** Limite conservativo per share nativo di un singolo file (Chrome/Android). */
const MAX_SINGLE_SHARE_BYTES = 15 * 1024 * 1024;

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
async function blobFromGalleryImage(url) {
  const sel = '#lbImg, .gal-grid img, .gal-hthumb img';
  for (const img of document.querySelectorAll(sel)) {
    const src = img.currentSrc || img.src;
    if (!src || !pathsMatch(src, url)) continue;
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

function canProgrammaticDownload() {
  const ua = navigator.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return !ios;
}

/** Web Share con file ha senso solo su mobile; su desktop Windows spesso dà NotAllowedError. */
function isMobileShareDevice() {
  const ua = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod/i.test(ua)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function fetchPhotoBlobUrl(url) {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (res.status >= 500 && attempt < maxAttempts - 1) continue;
    if (res.status === 401) throw new Error(t('sharePhotos.sessionExpired'));
    if (res.status === 403) throw new Error(t('sharePhotos.emailRequired'));
    if (!res.ok) throw new Error(t('sharePhotos.fetchFail'));
    const blob = await res.blob();
    if (!blob.size) throw new Error(t('sharePhotos.fetchFail'));
    const ct = res.headers.get('content-type') || blob.type || '';
    if (ct.includes('application/json')) throw new Error(t('sharePhotos.fetchFail'));
    return blob;
  }
  throw new Error(t('sharePhotos.fetchFail'));
}

async function fetchPhotoBlob(photo) {
  const url = photo?.url;
  if (url) {
    const fromDom = await blobFromGalleryImage(url);
    if (fromDom) return fromDom;
  }

  const candidates = [];
  if (url) candidates.push(url);
  if (photo?.id) candidates.push(`/api/photos/${photo.id}/file`);

  let lastErr;
  for (const candidate of candidates) {
    try {
      return await fetchPhotoBlobUrl(candidate);
    } catch (err) {
      lastErr = err;
      if (err.message === t('sharePhotos.sessionExpired')) {
        try {
          await fetchMe();
          return await fetchPhotoBlobUrl(candidate);
        } catch {
          throw err;
        }
      }
    }
  }

  throw lastErr || new Error(t('sharePhotos.fetchFail'));
}

async function photoToFile(photo, trip, index) {
  const blob = await fetchPhotoBlob(photo);
  const ext = extFromUrl(photo.url);
  const type = blob.type?.startsWith('image/') ? blob.type : (MIME_BY_EXT[ext] || 'image/jpeg');
  const name = `${safeBaseName(trip)}_${String(index + 1).padStart(2, '0')}.${ext}`;
  return new File([blob], name, { type, lastModified: Date.now() });
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

/** True se il dispositivo può condividere nativamente questi file. */
function canShareFiles(files) {
  if (!navigator.share || !files?.length) return false;
  if (!navigator.canShare) return true;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

function isZipFile(file) {
  return file?.type === 'application/zip' || /\.zip$/i.test(file?.name || '');
}

/**
 * canShare() su Windows desktop mente: accetta ZIP ma share() lancia NotAllowedError.
 * Su desktop offriamo il foglio nativo solo su mobile; su desktop solo per singole immagini.
 */
function canNativeShareFiles(files) {
  if (!files?.length || !navigator.share) return false;
  if (!isMobileShareDevice()) {
    if (files.some(isZipFile)) return false;
    if (files.length !== 1) return false;
    const f = files[0];
    if (!f.type?.startsWith('image/') || f.size > MAX_SINGLE_SHARE_BYTES) return false;
  }
  return canShareFiles(files);
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

/** Scarica sul disco o apre il foglio di condivisione su iOS. */
async function deliverFile(file) {
  if (!canProgrammaticDownload() && navigator.share) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
      throw err;
    }
  }
  downloadFiles([file]);
}

/**
 * Scarica l'album come ZIP (o condivide su iOS).
 * @param {object} trip
 * @param {{ onProgress?: (done: number, total: number) => void, photos?: object[] }} [opts]
 */
export async function downloadAlbumAsZip(trip, { onProgress, photos } = {}) {
  await ensureSession();
  const list = (photos || await api.fetchPhotos(trip.id, { fresh: true })).filter(p => p.url);
  if (!list.length) throw new Error(t('gal.noPhotos'));

  onProgress?.(0, list.length);
  const files = await buildPhotoFiles(list, trip, onProgress);

  if (files.length === 1) {
    await deliverFile(files[0]);
    return;
  }

  onProgress?.(list.length, list.length);
  const zip = await buildZipFile(files, trip);
  await deliverFile(zip);
}

/** Scarica o condivide una singola foto (lightbox). */
export async function downloadSinglePhoto(trip, photo) {
  await ensureSession();
  if (!photo?.url) throw new Error(t('sharePhotos.fetchFail'));
  const file = await photoToFile(photo, trip, 0);
  if (canNativeShareFiles([file]) && isMobileShareDevice()) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }
  await deliverFile(file);
}
