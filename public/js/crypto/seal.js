/**
 * seal.js — Cifratura simmetrica AES-256-GCM (formato WFENC1)
 * Usata per avvolgere chiavi private utente, trip key backup e share wrap.
 */

import { concat } from './bytes.js';

const MAGIC = new TextEncoder().encode('WFENC1');
const IV_LEN = 12;

export async function sealBytes(plain, aesKey) {
  const data = plain instanceof Uint8Array ? plain : new Uint8Array(plain);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, data);
  return concat(MAGIC, iv, new Uint8Array(ct));
}

export async function openBytes(sealed, aesKey) {
  const bytes = sealed instanceof Uint8Array ? sealed : new Uint8Array(sealed);
  if (bytes.length < MAGIC.length + IV_LEN + 16) throw new Error('Blob cifrato troppo corto');
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) throw new Error('Formato cifrato non valido');
  }
  const iv = bytes.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const body = bytes.subarray(MAGIC.length + IV_LEN);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, body);
  return new Uint8Array(plain);
}
