/**
 * crypto/photoCrypto.js — Cifratura foto lato browser (Web Crypto API)
 *
 * Formato file cifrato "WFENC1" (identico alla versione Node):
 *   magic(6) "WFENC1" + iv(12) + ciphertext + tag(16)   — AES-256-GCM
 *
 * Le foto vengono cifrate nel browser prima dell'upload e decifrate qui
 * al momento della visualizzazione: Telegram riceve sempre solo byte cifrati.
 */

const MAGIC = new TextEncoder().encode('WFENC1'); // 6 byte
const IV_LEN = 12;

/** Importa 32 byte grezzi come chiave AES-GCM. */
export async function importTripKey(rawBytes) {
  const buf = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
  if (buf.length !== 32) throw new Error('Chiave di cifratura non valida');
  return crypto.subtle.importKey('raw', buf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** base64 → Uint8Array */
export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesEqual(a, b, len) {
  for (let i = 0; i < len; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True se i byte iniziano col magic WFENC1. */
export function isEncryptedBytes(bytes) {
  return bytes.length >= MAGIC.length && bytesEqual(bytes, MAGIC, MAGIC.length);
}

/**
 * Cifra un ArrayBuffer/Uint8Array con la tripKey.
 * @returns {Promise<Blob>} blob application/octet-stream (magic+iv+ct+tag)
 */
export async function encryptPhoto(plain, cryptoKey) {
  const data = plain instanceof Uint8Array ? plain : new Uint8Array(plain);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, data);
  return new Blob([MAGIC, iv, new Uint8Array(ct)], { type: 'application/octet-stream' });
}

/**
 * Decifra byte prodotti da encryptPhoto (o dalla versione Node).
 * @returns {Promise<ArrayBuffer>} i byte originali dell'immagine
 */
export async function decryptPhoto(blobBytes, cryptoKey) {
  const bytes = blobBytes instanceof Uint8Array ? blobBytes : new Uint8Array(blobBytes);
  if (!isEncryptedBytes(bytes)) throw new Error('File non cifrato');
  const iv = bytes.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const body = bytes.subarray(MAGIC.length + IV_LEN);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, body);
}
