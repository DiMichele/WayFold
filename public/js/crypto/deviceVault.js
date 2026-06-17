/**
 * deviceVault.js — Sessione E2E persistente sul dispositivo (invisibile all'utente)
 *
 * Dopo login/registrazione le chiavi di decifratura restano sul browser,
 * cifrate con un segreto generato localmente. Al reload dell'app (sessione
 * cookie ancora valida) lo sblocco avviene in automatico — nessuna password extra.
 * Il server non vede né può decifrare questi blob.
 */

import { bytesToB64, b64ToBytes } from './bytes.js';
import { importMasterKey } from './masterKey.js';
import { sealBytes, openBytes } from './seal.js';
import {
  setSessionCrypto, getPrivateKey, getPublicKeyRaw, getMasterKeyRaw, sessionReady,
} from './sessionCrypto.js';

const DB_NAME = 'wayfold-device';
const DB_VER = 1;
const META_STORE = 'meta';
const SESSION_STORE = 'sessions';

let _deviceAesKey = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(SESSION_STORE)) db.createObjectStore(SESSION_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(store, key) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  }));
}

function idbSet(store, key, value) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbDel(store, key) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

/** Chiave AES locale al dispositivo (generata una volta, non esce dal browser). */
async function getDeviceAesKey() {
  if (_deviceAesKey) return _deviceAesKey;
  let raw = await idbGet(META_STORE, 'deviceSecret');
  if (!raw) {
    raw = crypto.getRandomValues(new Uint8Array(32));
    await idbSet(META_STORE, 'deviceSecret', raw);
  }
  _deviceAesKey = await crypto.subtle.importKey(
    'raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
  );
  return _deviceAesKey;
}

/** Salva la sessione crypto corrente per auto-sblocco futuro. */
export async function persistDeviceSession(userId) {
  if (!userId || !sessionReady()) return;
  const privateKey = getPrivateKey();
  const publicKeyRaw = getPublicKeyRaw();
  const masterKeyRaw = getMasterKeyRaw();
  if (!privateKey || !publicKeyRaw || !masterKeyRaw) return;

  const deviceKey = await getDeviceAesKey();
  const privateKeyRaw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));

  await idbSet(SESSION_STORE, String(userId), {
    encMaster: bytesToB64(await sealBytes(masterKeyRaw, deviceKey)),
    encPrivate: bytesToB64(await sealBytes(privateKeyRaw, deviceKey)),
    publicKey: bytesToB64(publicKeyRaw),
    v: 1,
  });
}

/** Ripristina la sessione crypto dal vault locale (silenzioso). */
export async function restoreDeviceSession(user) {
  if (!user?.id || !user.publicKey) return false;
  if (sessionReady()) return true;

  const blob = await idbGet(SESSION_STORE, String(user.id));
  if (!blob?.encMaster || !blob?.encPrivate) return false;

  try {
    const deviceKey = await getDeviceAesKey();
    const masterKeyRaw = await openBytes(b64ToBytes(blob.encMaster), deviceKey);
    const privateKeyRaw = await openBytes(b64ToBytes(blob.encPrivate), deviceKey);
    const masterKey = await importMasterKey(masterKeyRaw);
    const privateKey = await crypto.subtle.importKey(
      'pkcs8', privateKeyRaw, { name: 'X25519' }, false, ['deriveKey', 'deriveBits'],
    );
    const publicKeyRaw = blob.publicKey ? b64ToBytes(blob.publicKey) : b64ToBytes(user.publicKey);
    setSessionCrypto({ masterKey, masterKeyRaw, privateKey, publicKeyRaw });
    return true;
  } catch {
    await clearDeviceSession(user.id);
    return false;
  }
}

/** Logout: rimuove la sessione locale dell'utente. */
export async function clearDeviceSession(userId) {
  _deviceAesKey = null;
  if (userId) await idbDel(SESSION_STORE, String(userId));
}
