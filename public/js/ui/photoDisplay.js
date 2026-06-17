/**
 * ui/photoDisplay.js — Mostra le foto decifrandole nel browser
 *
 * Le foto cifrate arrivano dal server come byte opachi (WFENC1). Qui vengono
 * scaricate, decifrate con la chiave del viaggio e trasformate in blob URL da
 * assegnare agli <img>. Le foto non cifrate (legacy) usano direttamente l'URL.
 */

import { getTripKey, clearTripKeys } from '../crypto/keyStore.js';
import { decryptPhoto } from '../crypto/photoCrypto.js';

const _objectUrls = new Map(); // photoId → objectURL (plaintext)
const _inflight = new Map();   // photoId → Promise<string|null>

/**
 * Scarica e decifra una foto, restituendo un blob URL (con cache per photoId).
 * @returns {Promise<string|null>}
 */
function resolveObjectUrl({ tripId, photoId, url, mime, isOwner = false }) {
  if (_objectUrls.has(photoId)) return Promise.resolve(_objectUrls.get(photoId));
  if (_inflight.has(photoId)) return _inflight.get(photoId);

  const promise = (async () => {
    const key = await getTripKey(tripId, { isOwner });
    if (!key) return null;
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const plain = await decryptPhoto(new Uint8Array(buf), key);
    const objUrl = URL.createObjectURL(new Blob([plain], { type: mime || 'image/jpeg' }));
    _objectUrls.set(photoId, objUrl);
    return objUrl;
  })()
    .catch(() => null)
    .finally(() => _inflight.delete(photoId));

  _inflight.set(photoId, promise);
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
async function blobFromObjectUrl(objUrl) {
  try {
    const res = await fetch(objUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob?.size ? blob : null;
  } catch {
    return null;
  }
}

export async function fetchDecryptedBlob({ tripId, url, encrypted, mime, isOwner = false }) {
  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    if (res.status >= 500 && attempt < maxAttempts - 1) continue;
    if (!res.ok) return null;
    if (!encrypted) return res.blob();
    const key = await getTripKey(tripId, { isOwner });
    if (!key) return null;
    const buf = await res.arrayBuffer();
    const plain = await decryptPhoto(new Uint8Array(buf), key);
    return new Blob([plain], { type: mime || 'image/jpeg' });
  }
  return null;
}

/**
 * Blob in chiaro per export/condivisione: riusa la decifratura già in cache
 * (galleria/lightbox) prima di un nuovo fetch di rete.
 */
export async function exportPhotoBlob({ tripId, photoId, url, encrypted, mime, isOwner = false }) {
  if (encrypted && photoId != null) {
    if (_objectUrls.has(photoId)) {
      const blob = await blobFromObjectUrl(_objectUrls.get(photoId));
      if (blob) return blob;
    }
    if (_inflight.has(photoId)) {
      const objUrl = await _inflight.get(photoId).catch(() => null);
      if (objUrl) {
        const blob = await blobFromObjectUrl(objUrl);
        if (blob) return blob;
      }
    }
    if (url) {
      const objUrl = await resolveObjectUrl({ tripId, photoId, url, mime, isOwner });
      if (objUrl) {
        const blob = await blobFromObjectUrl(objUrl);
        if (blob) return blob;
      }
    }
  }
  return fetchDecryptedBlob({ tripId, url, encrypted, mime, isOwner });
}

/** Svuota cache immagini e chiavi (logout). */
export function clearImageCache() {
  for (const objUrl of _objectUrls.values()) URL.revokeObjectURL(objUrl);
  _objectUrls.clear();
  _inflight.clear();
  clearTripKeys();
}
