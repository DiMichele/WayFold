/**
 * tripKeyVault.js — Gestione chiavi viaggio (solo client)
 * Generazione, IndexedDB, backup cifrato sul server, share code.
 */

import { importTripKey } from './photoCrypto.js';
import { bytesToB64, b64ToBytes, sha256Hex } from './bytes.js';
import { getMasterKey, sessionReady } from './sessionCrypto.js';
import { wrapTripKeyForBackup, unwrapTripKeyFromBackup } from './userKeys.js';
import { deriveShareKey } from './masterKey.js';
import { sealBytes, openBytes } from './seal.js';

const DB_NAME = 'wayfold-e2e';
const DB_VER = 1;
const STORE = 'tripKeys';

const _mem = new Map(); // tripId → CryptoKey
const _pending = new Map(); // tripId → Promise<CryptoKey|null>

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(tripId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(String(tripId));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(tripId, rawBytes) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rawBytes, String(tripId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearTripKeyVault() {
  _mem.clear();
  _pending.clear();
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* IndexedDB non disponibile */ }
}

/** Elenco tripId → raw key bytes in IndexedDB. */
async function listLocalTripKeyBytes() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const out = new Map();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) { resolve(out); return; }
      out.set(Number(cur.key), cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Dopo cambio password: ri-avvolge tutte le chiavi viaggio con la nuova master key. */
export async function rewrapAllTripKeys(newMasterKey) {
  const keys = await listLocalTripKeyBytes();
  const uploads = [];
  for (const [tripId, raw] of keys) {
    const wrap = await wrapTripKeyForBackup(raw, newMasterKey);
    uploads.push({ tripId, wrap });
    await uploadKeyWrap(tripId, wrap);
  }
  return uploads;
}

function generateTripKeyRaw() {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function importRaw(raw) {
  return importTripKey(raw);
}

async function fetchKeyWrap(tripId) {
  const res = await fetch(`/api/trips/${tripId}/key-wrap`, { credentials: 'same-origin' });
  if (res.status === 404) return { missing: true, wrap: null };
  if (!res.ok) {
    const err = new Error(`Wrap non leggibile (${res.status})`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json().catch(() => null);
  const wrap = body?.wrap || null;
  return { missing: !wrap, wrap };
}

async function uploadKeyWrap(tripId, wrap, { overwrite = false } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 250 * attempt));
    try {
      const res = await fetch(`/api/trips/${tripId}/key-wrap`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wrap, overwrite }),
      });
      if (res.ok) return;
      lastErr = new Error(`Backup chiave non riuscito (${res.status})`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Backup chiave non riuscito');
}

async function backupLocalKey(tripId, raw) {
  if (!sessionReady() || !raw) return;
  try {
    const remote = await fetchKeyWrap(tripId);
    if (remote.wrap) return;
    const backup = await wrapTripKeyForBackup(raw, getMasterKey());
    await uploadKeyWrap(tripId, backup, { overwrite: false });
  } catch { /* riprova al prossimo avvio */ }
}

/** Genera chiave, salva localmente e carica backup cifrato sul server. */
export async function initTripKey(tripId) {
  if (!sessionReady()) return null;
  try {
    const remote = await fetchKeyWrap(tripId);
    if (remote.wrap) {
      const existing = await loadFromServerWrap(tripId, remote.wrap);
      if (existing) return existing;
      return null;
    }
  } catch {
    return null;
  }

  const raw = generateTripKeyRaw();
  const mk = getMasterKey();
  const wrap = await wrapTripKeyForBackup(raw, mk);
  await idbSet(tripId, raw);
  const cryptoKey = await importRaw(raw);
  _mem.set(Number(tripId), cryptoKey);
  await uploadKeyWrap(tripId, wrap, { overwrite: false });
  return cryptoKey;
}

async function loadFromServerWrap(tripId, wrapArg = null) {
  if (!sessionReady()) return null;
  const wrap = wrapArg || (await fetchKeyWrap(tripId)).wrap;
  if (!wrap) return null;
  try {
    const raw = await unwrapTripKeyFromBackup(wrap, getMasterKey());
    await idbSet(tripId, raw);
    const cryptoKey = await importRaw(raw);
    _mem.set(Number(tripId), cryptoKey);
    return cryptoKey;
  } catch {
    return null;
  }
}

/**
 * Restituisce CryptoKey del viaggio o null se non disponibile.
 * @param {number} tripId
 * @param {{ isOwner?: boolean, allowCreate?: boolean }} opts
 */
export async function resolveTripKey(tripId, { isOwner = false, allowCreate = false } = {}) {
  const id = Number(tripId);
  if (_mem.has(id)) return _mem.get(id);
  if (_pending.has(id)) return _pending.get(id);

  const promise = (async () => {
    const cached = await idbGet(id);
    if (cached) {
      const key = await importRaw(cached);
      _mem.set(id, key);
      if (sessionReady()) backupLocalKey(id, cached);
      return key;
    }
    try {
      const fromServer = await loadFromServerWrap(id);
      if (fromServer) return fromServer;
    } catch {
      return null;
    }
    if (allowCreate && isOwner) return initTripKey(id);
    return null;
  })();

  _pending.set(id, promise);
  try {
    return await promise;
  } finally {
    _pending.delete(id);
  }
}

/** Crea payload per codice invito (codice mai inviato al server in chiaro nel DB). */
export async function buildShareCodePayload(tripId, permission) {
  const id = Number(tripId);
  let key = _mem.get(id);
  if (!key) key = await resolveTripKey(id, { isOwner: true, allowCreate: false });
  if (!key) key = await initTripKey(id);
  if (!key) throw new Error('Chiave album non disponibile');

  const raw = await idbGet(id);
  if (!raw || raw.length !== 32) throw new Error('Chiave album non disponibile');

  const codeBytes = crypto.getRandomValues(new Uint8Array(12));
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < codeBytes.length; i++) {
    code += alphabet[codeBytes[i] % alphabet.length];
  }

  const wrapSalt = crypto.getRandomValues(new Uint8Array(16));
  const shareKey = await deriveShareKey(code, id, wrapSalt);
  const keyWrap = bytesToB64(await sealBytes(raw, shareKey));
  const codeHash = await sha256Hex(code);

  return {
    code,
    codeHash,
    keyWrap,
    wrapSalt: bytesToB64(wrapSalt),
    permission,
  };
}

/** Sblocca chiave album da codice invito dopo riscatto. */
export async function unlockTripKeyFromShare(tripId, shareCode, keyWrap, wrapSaltB64) {
  const shareKey = await deriveShareKey(shareCode, Number(tripId), b64ToBytes(wrapSaltB64));
  const raw = await openBytes(b64ToBytes(keyWrap), shareKey);
  if (raw.length !== 32) throw new Error('Codice invito non valido');
  await idbSet(tripId, raw);
  const cryptoKey = await importRaw(raw);
  _mem.set(Number(tripId), cryptoKey);

  if (sessionReady()) {
    const backup = await wrapTripKeyForBackup(raw, getMasterKey());
    await uploadKeyWrap(tripId, backup);
  }
  return cryptoKey;
}

/** Scarica/sblocca le chiavi album dal backup account sul server (cross-device). */
export async function prefetchTripKeys(trips) {
  if (!sessionReady() || !Array.isArray(trips)) return;
  await Promise.all(trips.map(t => resolveTripKey(t.id, {
    isOwner: Boolean(t.isOwner),
    allowCreate: false,
  })));
}
