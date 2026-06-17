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

function imgReady(img) {
  return img.complete && img.naturalWidth > 0;
}

async function blobFromMountedImage(photoId) {
  const id = String(photoId);
  for (const img of document.querySelectorAll('#lbImg, .gal-grid img, .gal-hthumb img')) {
    if (img.dataset.photoId !== id) continue;
    if (!imgReady(img)) continue;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d').drawImage(img, 0, 0);
      const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (blob?.size) return blob;
    } catch {
      /* canvas non disponibile */
    }
  }
  return null;
}

function rememberPlainBlob(photoId, blob) {
  const pid = normalizePhotoId(photoId);
  if (pid != null && blob?.size) _plainBlobs.set(pid, blob);
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
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
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
export function mountImage(img, { tripId, photoId, url, encrypted, mime }) {
  if (!img || !url) return;
  if (photoId != null) img.dataset.photoId = String(photoId);
  if (!encrypted) {
    img.src = url;
    return;
  }
  // Marca la richiesta corrente: se l'<img> viene riusato (lightbox/hero) e
  // l'utente naviga prima che la decifratura finisca, scartiamo i risultati
  // ormai obsoleti.
  const token = String(photoId);
  img.dataset.encReq = token;
  img.classList.add('enc-pending');
  resolveObjectUrl({ tripId, photoId, url, mime }).then(objUrl => {
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
  });
}

/**
 * Blob in chiaro di una foto (per export/condivisione). Per le foto cifrate
 * scarica i byte e li decifra; per le legacy scarica direttamente.
 * @returns {Promise<Blob|null>}
 */
export async function fetchDecryptedBlob({ tripId, photoId, url, encrypted, mime, isOwner = false }) {
  const pid = normalizePhotoId(photoId);
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));
    try {
      const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
      if (res.status >= 500 && attempt < maxAttempts - 1) continue;
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!buf.length) return null;
      if (!encrypted && !isEncryptedBytes(buf)) {
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
 * Blob in chiaro per export/condivisione: riusa blob già decifrati o immagini
 * montate in pagina prima di un nuovo fetch di rete.
 */
export async function exportPhotoBlob({ tripId, photoId, url, encrypted, mime, isOwner = false }) {
  const pid = normalizePhotoId(photoId);

  if (encrypted && pid != null) {
    const cached = _plainBlobs.get(pid);
    if (cached?.size) return cached;

    const fromDom = await blobFromMountedImage(pid);
    if (fromDom) {
      rememberPlainBlob(pid, fromDom);
      return fromDom;
    }

    if (_inflight.has(pid)) {
      await _inflight.get(pid).catch(() => null);
      const warmed = _plainBlobs.get(pid);
      if (warmed?.size) return warmed;
    }

    if (url) {
      await resolveObjectUrl({ tripId, photoId: pid, url, mime, isOwner });
      const warmed = _plainBlobs.get(pid);
      if (warmed?.size) return warmed;
    }
  }

  const blob = await fetchDecryptedBlob({ tripId, photoId: pid, url, encrypted, mime, isOwner });
  if (blob?.size && encrypted) rememberPlainBlob(pid, blob);
  return blob;
}

function photoUrls(photo) {
  const urls = [];
  if (photo?.url) urls.push(photo.url);
  if (photo?.id) urls.push(`/api/photos/${photo.id}/file`);
  return urls;
}

/**
 * Carica il blob in chiaro per export/condivisione (stesso percorso della galleria).
 * @returns {Promise<Blob|null>}
 */
export async function loadPhotoForShare(photo, trip) {
  const tripId = photo?.tripId ?? trip?.id;
  const pid = normalizePhotoId(photo?.id);
  const mime = photo?.originalMime || photo?.mime || 'image/jpeg';
  const encrypted = Boolean(photo?.encrypted);
  const isOwner = false;

  if (pid != null) {
    const cached = _plainBlobs.get(pid);
    if (cached?.size) return cached;
    const fromDom = await blobFromMountedImage(pid);
    if (fromDom?.size) {
      rememberPlainBlob(pid, fromDom);
      return fromDom;
    }
  }

  for (const url of photoUrls(photo)) {
    const blob = await exportPhotoBlob({
      tripId,
      photoId: pid,
      url,
      encrypted,
      mime,
      isOwner,
    });
    if (blob?.size) return blob;

    const fetched = await fetchDecryptedBlob({
      tripId,
      photoId: pid,
      url,
      encrypted: true,
      mime,
      isOwner,
    });
    if (fetched?.size) return fetched;
  }

  return null;
}

/** Precarica i blob decifrati per l'export album (dopo il render galleria). */
export async function prefetchPhotosForExport(photos, trip) {
  if (!photos?.length || !trip?.id) return;
  const tripId = trip.id;
  await getTripKey(tripId, { isOwner: false });
  for (const photo of photos) {
    if ((photo.tripId ?? tripId) !== tripId) continue;
    await loadPhotoForShare(photo, trip);
  }
}

/** Svuota cache immagini e chiavi (logout). */
export function clearImageCache() {
  for (const objUrl of _objectUrls.values()) URL.revokeObjectURL(objUrl);
  _objectUrls.clear();
  _plainBlobs.clear();
  _inflight.clear();
  clearTripKeys();
}
