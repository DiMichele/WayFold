/**
 * masterKey.js — Chiave master derivata dalla password (solo client)
 */

const PBKDF2_ITER = 310000;

/** 32 byte grezzi derivati dalla password (PBKDF2). */
export async function deriveMasterKeyMaterial(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password || '')),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export async function importMasterKey(rawBytes) {
  return crypto.subtle.importKey(
    'raw',
    rawBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function deriveMasterKey(password, saltBytes) {
  return importMasterKey(await deriveMasterKeyMaterial(password, saltBytes));
}

/** Deriva una chiave AES da codice invito + sale (condivisione album). */
export async function deriveShareKey(shareCode, tripId, saltBytes) {
  const enc = new TextEncoder();
  const material = enc.encode(`${String(shareCode).trim().toUpperCase()}|${tripId}`);
  const keyMaterial = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
