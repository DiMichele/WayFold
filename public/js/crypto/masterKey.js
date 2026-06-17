/**
 * masterKey.js — Chiave master derivata dalla password (solo client)
 */

const PBKDF2_ITER = 310000;

export async function deriveMasterKey(password, saltBytes) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(String(password || '')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITER, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
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
