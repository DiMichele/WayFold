/**
 * ui/photoDisplay.js — Mostra le foto decifrandole nel browser
 *
 * Le foto cifrate arrivano dal server come byte opachi (WFENC1). Qui vengono
 * scaricate, decifrate con la chiave del viaggio e trasformate in blob URL da
 * assegnare agli <img>. Le foto non cifrate (legacy) usano direttamente l'URL.
 */

import { getTripKey, clearTripKeys } from '../crypto/keyStore.js';
import { decryptPhoto, isEncryptedBytes } from '../crypto/photoCrypto.js';

const _objectUrls = new Map(); // photoId → objectURL (plaintext)
const _plainBlobs = new Map(); // photoId → Blob (plaintext, per export)
const _inflight = new Map();   // photoId → Promise<string|null>

function normalizePhotoId(photoId) {
  const id = Number(photoId);
  return Number.isFinite(id) ? id : null;
}

function rememberPlainBlob(photoId, blob) {
  const pid = normalizePhotoId(photoId);
  if (pid != null && blob?.size) _plainBlobs.set(pid, blob);
}

function raceTimeout(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      () => { clearTimeout(timer); resolve(null); },
    );
  });
}

async function fetchSameOrigin(url, timeoutMs = 22000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: ctrl.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function photoFileUrls(photo) {
  const urls = [];
  if (photo?.url) urls.push(photo.url);
  if (photo?.id) urls.push(`/api/photos/${photo.id}/file`);
  return urls;
}

/**
 * Scarica e decifra una foto, restituendo un blob URL (con cache per photoId).
 * @returns {Promise<string|null>}
 */
function resolveObjectUrl({ tripId, photoId, url, mime, isOwner = false }) {
  const pid = normalizePhotoId(photoId);
  if (pid == null) return Promise.resolve(null);
  if (_objectUrls.has(pid)) return Promise.resolve(_objectUrls.get(pid));
  if (_inflight.has(pid)) return _inflight.get(pid);

  const promise = (async () => {
    const key = await getTripKey(tripId, { isOwner });
    if (!key) return null;
    const res = await fetchSameOrigin(url);
    if (!res?.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const plain = await decryptPhoto(buf, key);
    const blob = new Blob([plain], { type: mime || 'image/jpeg' });
    rememberPlainBlob(pid, blob);
    const objUrl = URL.createObjectURL(blob);
    _objectUrls.set(pid, objUrl);
    return objUrl;
  })()
    .catch(() => null)
    .finally(() => _inflight.delete(pid));

  _inflight.set(pid, promise);
  return promise;
}

/**
 * Assegna a un <img> l'immagine giusta: per le foto cifrate decifra e usa un
 * blob URL, per quelle legacy imposta direttamente src.
 */
export function mountImage(img, { tripId, photoId, url, encrypted, mime, isOwner = false }) {
  if (!img || !url) return;
  if (photoId != null) img.dataset.photoId = String(photoId);
  img.dataset.encTrip = String(tripId || '');
  img.dataset.encUrl = url;
  img.dataset.encMime = mime || '';
  img.dataset.encOwner = isOwner ? '1' : '0';
  if (!encrypted) {
    img.src = url;
    return;
  }
  const token = String(photoId);
  img.dataset.encReq = token;
  img.classList.add('enc-pending');
  img.classList.remove('enc-locked');
  resolveObjectUrl({ tripId, photoId, url, mime, isOwner }).then(objUrl => {
    if (img.dataset.encReq !== token) return;
    img.classList.remove('enc-pending');
    if (objUrl) img.src = objUrl;
    else img.classList.add('enc-locked');
  });
}

/** Variante per le copertine dei viaggi (usa i campi cover* serializzati). */
export function mountCover(img, trip) {
  if (!img || !trip?.coverUrl) return;
  mountImage(img, {
    tripId: trip.id,
    photoId: trip.coverPhotoId,
    url: trip.coverUrl,
    encrypted: trip.coverEncrypted,
    mime: trip.coverMime,
    isOwner: Boolean(trip.isOwner),
  });
}

/** Dopo lo sblocco E2E: ritenta le immagini rimaste bloccate. */
export function remountLockedImages() {
  document.querySelectorAll('img.enc-locked[data-enc-url]').forEach(img => {
    mountImage(img, {
      tripId: Number(img.dataset.encTrip),
      photoId: img.dataset.photoId,
      url: img.dataset.encUrl,
      encrypted: true,
      mime: img.dataset.encMime || '',
      isOwner: img.dataset.encOwner === '1',
    });
  });
}

async function fetchDecryptedBlob({ tripId, photoId, url, mime, isOwner = false, maxAttempts = 3 }) {
  const pid = normalizePhotoId(photoId);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt));
    try {
      const res = await fetchSameOrigin(url);
      if (!res) {
        if (attempt < maxAttempts - 1) continue;
        return null;
      }
      if (res.status >= 500 && attempt < maxAttempts - 1) continue;
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!buf.length) return null;
      if (!isEncryptedBytes(buf)) {
        return new Blob([buf], { type: mime || 'image/jpeg' });
      }
      const key = await getTripKey(tripId, { isOwner });
      if (!key) return null;
      const plain = await decryptPhoto(buf, key);
      const blob = new Blob([plain], { type: mime || 'image/jpeg' });
      rememberPlainBlob(pid, blob);
      return blob;
    } catch {
      if (attempt < maxAttempts - 1) continue;
      return null;
    }
  }
  return null;
}

/**
 * Restituisce il blob in chiaro di una foto (condivisione / download).
 * Riutilizza la decifratura già in corso o in cache dalla galleria.
 * @returns {Promise<Blob|null>}
 */
export async function awaitPlainBlob(photo, trip, { maxAttempts = 4 } = {}) {
  const tripId = photo?.tripId ?? trip?.id;
  const pid = normalizePhotoId(photo?.id);
  const mime = photo?.originalMime || photo?.mime || 'image/jpeg';
  if (!tripId || !photo?.url) return null;

  if (pid != null) {
    const cached = _plainBlobs.get(pid);
    if (cached?.size) return cached;
    if (_inflight.has(pid)) {
      await raceTimeout(_inflight.get(pid), 18000);
      const warmed = _plainBlobs.get(pid);
      if (warmed?.size) return warmed;
    }
  }

  if (photo.encrypted) {
    await resolveObjectUrl({ tripId, photoId: pid, url: photo.url, mime, isOwner: false });
    if (pid != null) {
      const warmed = _plainBlobs.get(pid);
      if (warmed?.size) return warmed;
    }
  }

  for (const url of photoFileUrls(photo)) {
    const blob = await fetchDecryptedBlob({
      tripId, photoId: pid, url, mime, isOwner: false, maxAttempts,
    });
    if (blob?.size) return blob;
  }
  return null;
}

/** Svuota cache immagini e chiavi (logout). */
export function clearImageCache() {
  for (const objUrl of _objectUrls.values()) URL.revokeObjectURL(objUrl);
  _objectUrls.clear();
  _plainBlobs.clear();
  _inflight.clear();
  clearTripKeys();
}
