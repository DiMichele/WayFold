/**
 * api.js — Client API
 *
 * Stessa origine del server che serve la web app: nessun URL hardcoded,
 * funziona in locale e in produzione. Cache foto in memoria con invalidazione
 * (usata dalla sync automatica quando arrivano foto nuove).
 */

import { getLang } from './i18n.js';
import { getTripKey } from './crypto/keyStore.js';
import { encryptPhoto } from './crypto/photoCrypto.js';
import { state } from './state.js';

async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': getLang(),
      ...options.headers,
    },
    credentials: 'same-origin',
    ...options,
  });
  let body = null;
  try { body = await res.json(); } catch { /* risposta senza body */ }
  if (!res.ok) {
    // Sessione scaduta/assente: redirect alla pagina di login
    if (res.status === 401 && !path.startsWith('/api/auth')) {
      window.dispatchEvent(new Event('wf:unauthorized'));
    }
    const err = new Error(body?.error || `Errore ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return body;
}

// ─── Auth ──────────────────────────────────────────────────────────────────

export function fetchMe() {
  return request('/api/auth/me');
}

export function login(username, password) {
  return request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
}

export function register(username, password, email, keys = null) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, email, ...(keys || {}) }),
  });
}

export function changePassword(currentPassword, newPassword, keys = null) {
  return request('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword, ...(keys || {}) }),
  });
}

export function updateEmail(email) {
  return request('/api/auth/email', { method: 'POST', body: JSON.stringify({ email }) });
}

export function verifyEmail(code) {
  return request('/api/auth/verify-email', { method: 'POST', body: JSON.stringify({ code }) });
}

export function resendVerification() {
  return request('/api/auth/resend-verification', { method: 'POST' });
}

export function forgotPassword(username) {
  return request('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ username }) });
}

export function resetPassword(username, code, newPassword) {
  return request('/api/auth/reset-password', { method: 'POST', body: JSON.stringify({ username, code, newPassword }) });
}

export function logout() {
  return request('/api/auth/logout', { method: 'POST' });
}

export function deleteAccount(password) {
  return request('/api/auth/account', { method: 'DELETE', body: JSON.stringify({ password }) });
}

// ─── Trips ─────────────────────────────────────────────────────────────────

export function fetchTrips() {
  return request('/api/trips');
}

export function createTrip(payload) {
  return request('/api/trips', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateTrip(id, payload) {
  return request(`/api/trips/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function deleteTrip(id) {
  return request(`/api/trips/${id}`, { method: 'DELETE' });
}

export function fetchPlaces({ q, field = 'dest', dest = '', country = '', lang = getLang() } = {}) {
  const params = new URLSearchParams({ q, field, lang });
  if (dest) params.set('dest', dest);
  if (country) params.set('country', country);
  return request(`/api/trips/places?${params}`);
}

export function reversePlace(lat, lon, lang = getLang()) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    lang,
  });
  return request(`/api/trips/places/reverse?${params}`);
}

// ─── Photos (con cache) ────────────────────────────────────────────────────

const _photoCache = new Map(); // tripId → Photo[]

export async function fetchPhotos(tripId, { fresh = false } = {}) {
  if (!fresh && _photoCache.has(tripId)) return _photoCache.get(tripId);
  const photos = await request(`/api/trips/${tripId}/photos`);
  _photoCache.set(tripId, photos);
  return photos;
}

export function invalidatePhotoCache(tripId = null) {
  if (tripId === null) _photoCache.clear();
  else _photoCache.delete(tripId);
}

export function deletePhoto(id) {
  return request(`/api/photos/${id}`, { method: 'DELETE' });
}

export function updatePhoto(id, payload) {
  return request(`/api/photos/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function setCover(tripId, photoId) {
  return request(`/api/trips/${tripId}/cover`, {
    method: 'POST',
    body: JSON.stringify({ photoId }),
  });
}

// ─── Share ─────────────────────────────────────────────────────────────────

export function createShareCode(tripId, payload) {
  return request(`/api/trips/${tripId}/share-codes`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchShareCodes(tripId) {
  return request(`/api/trips/${tripId}/share-codes`);
}

export function fetchTripMembers(tripId) {
  return request(`/api/trips/${tripId}/members`);
}

export function revokeShareCode(codeId) {
  return request(`/api/share-codes/${codeId}`, { method: 'DELETE' });
}

export function removeTripMember(tripId, userId) {
  return request(`/api/trips/${tripId}/members/${userId}`, { method: 'DELETE' });
}

export function redeemShareCode(code) {
  return request('/api/shares/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

const UPLOAD_BATCH = 12;

const MIME_BY_EXT = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heic',
};
const EXT_BY_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/heic': 'heic', 'image/heif': 'heic',
};

function guessMime(file) {
  if (file.type) return file.type;
  const ext = (file.name || '').split('.').pop()?.toLowerCase();
  return MIME_BY_EXT[ext] || 'image/jpeg';
}

/** Cifra un file prima dell'upload (solo tipo MIME/origine, nessun EXIF/GPS). */
async function encryptForUpload(file, cryptoKey, index) {
  const buf = await file.arrayBuffer();
  const mime = guessMime(file);
  const meta = {
    originalMime: mime,
    originalExt: EXT_BY_MIME[mime] || 'jpg',
  };
  const blob = await encryptPhoto(buf, cryptoKey);
  const encFile = new File([blob], `photo_${Date.now()}_${index}.wfenc`, { type: 'application/octet-stream' });
  return { file: encFile, meta };
}

function uploadPhotosBatch(tripId, items, { caption = '', onProgress, encrypted = false } = {}) {
  const fd = new FormData();
  for (const it of items) fd.append('photos', it.file, it.file.name);
  if (caption) fd.append('caption', caption);
  if (encrypted) {
    fd.append('encrypted', '1');
    fd.append('meta', JSON.stringify(items.map(it => it.meta || {})));
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/trips/${tripId}/photos`);
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', e => {
      if (!onProgress) return;
      const frac = e.lengthComputable && e.total > 0 ? e.loaded / e.total : 0;
      onProgress(frac, { processing: frac >= 0.995 });
    });
    xhr.addEventListener('load', () => {
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* no body */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else {
        if (xhr.status === 401) window.dispatchEvent(new Event('wf:unauthorized'));
        reject(new Error(body?.error || `Errore ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Errore di rete')));
    xhr.send(fd);
  });
}

/** Upload multiplo verso l'archivio del viaggio (batch da 12, progresso aggregato). */
export async function uploadPhotos(tripId, files, { caption = '', onProgress, onBatchStart } = {}) {
  const rawList = [...files];
  if (!rawList.length) return { photos: [], errors: [] };

  // E2E: cifratura obbligatoria nel browser prima dell'upload.
  const trip = state.trips.find(t => t.id === Number(tripId));
  const cryptoKey = await getTripKey(tripId, { isOwner: Boolean(trip?.isOwner) });
  if (!cryptoKey) {
    throw new Error('Chiave album non disponibile: sblocca la cifratura o apri l\'album dal dispositivo principale');
  }
  const encrypted = true;

  const items = [];
  for (let i = 0; i < rawList.length; i++) {
    items.push(await encryptForUpload(rawList[i], cryptoKey, i));
  }

  const batches = [];
  for (let i = 0; i < items.length; i += UPLOAD_BATCH) batches.push(items.slice(i, i + UPLOAD_BATCH));

  const totalBytes = items.reduce((s, it) => s + (it.file.size || 1), 0);
  let doneBytes = 0;
  const allPhotos = [];
  const allErrors = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const batchStartIdx = b * UPLOAD_BATCH;
    onBatchStart?.(batchStartIdx, batch.length, items.length);

    const batchBytes = batch.reduce((s, it) => s + (it.file.size || 1), 0);
    const batchCaption = b === 0 ? caption : '';

    const result = await uploadPhotosBatch(tripId, batch, {
      caption: batchCaption,
      encrypted,
      onProgress: (batchFrac, meta) => {
        if (!onProgress) return;
        const uploaded = doneBytes + batchFrac * batchBytes;
        const overall = totalBytes > 0
          ? uploaded / totalBytes
          : (batchStartIdx + batchFrac * batch.length) / items.length;
        onProgress(overall, {
          ...meta,
          batch: b + 1,
          batches: batches.length,
          filesDone: batchStartIdx + Math.round(batchFrac * batch.length),
          filesTotal: items.length,
        });
      },
    });

    doneBytes += batchBytes;
    onProgress?.(doneBytes / totalBytes, {
      processing: true,
      batch: b + 1,
      batches: batches.length,
      filesDone: batchStartIdx + batch.length,
      filesTotal: items.length,
    });

    allPhotos.push(...(result.photos || []));
    if (result.errors?.length) allErrors.push(...result.errors);
  }

  return { photos: allPhotos, errors: allErrors };
}

// ─── Status ────────────────────────────────────────────────────────────────

export function fetchStatus() {
  return request('/api/status');
}
