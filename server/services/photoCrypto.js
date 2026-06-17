/**
 * photoCrypto.js — Cifratura foto lato server (Node crypto)
 *
 * Formato file cifrato "WFENC1" (identico alla versione browser):
 *   magic(6) "WFENC1" + iv(12) + ciphertext + tag(16)   — AES-256-GCM
 *
 * Le foto vengono cifrate con una chiave per-viaggio (tripKey, 32 byte).
 * La tripKey non è mai salvata in chiaro: viene custodita come "escrow",
 * cioè cifrata con PHOTO_BOT_ESCROW_KEY (segreto del server). Questo
 * permette al bot di ri-cifrare le foto inviate direttamente su Telegram
 * e al server di consegnare la chiave ai soli utenti autorizzati via API.
 */

const crypto = require('crypto');
const config = require('../config');

const MAGIC = Buffer.from('WFENC1', 'ascii');
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function escrowKey() {
  const raw = (config.PHOTO_BOT_ESCROW_KEY || '').trim();
  if (!raw) return null;
  let buf;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    return null;
  }
  return buf.length === KEY_LEN ? buf : null;
}

function escrowAvailable() {
  return Boolean(escrowKey());
}

/** @returns {boolean} true se il buffer inizia col magic WFENC1. */
function isEncrypted(buf) {
  return Buffer.isBuffer(buf) && buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

function toKeyBuffer(key) {
  const buf = Buffer.isBuffer(key) ? key : Buffer.from(key, 'base64');
  if (buf.length !== KEY_LEN) {
    throw Object.assign(new Error('Chiave di cifratura non valida'), { status: 500 });
  }
  return buf;
}

/** Cifra un buffer di byte. @returns {Buffer} magic+iv+ct+tag */
function encryptBuffer(plain, key) {
  const keyBuf = toKeyBuffer(key);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, ct, tag]);
}

/** Decifra un buffer prodotto da encryptBuffer. @returns {Buffer} */
function decryptBuffer(blob, key) {
  if (!isEncrypted(blob)) {
    throw Object.assign(new Error('File non cifrato (magic mancante)'), { status: 400 });
  }
  const keyBuf = toKeyBuffer(key);
  const iv = blob.subarray(MAGIC.length, MAGIC.length + IV_LEN);
  const tag = blob.subarray(blob.length - TAG_LEN);
  const ct = blob.subarray(MAGIC.length + IV_LEN, blob.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/** Nuova chiave casuale per un viaggio. @returns {Buffer} 32 byte */
function generateTripKey() {
  return crypto.randomBytes(KEY_LEN);
}

/** Avvolge la tripKey con la chiave di escrow del server. @returns {string} base64 */
function wrapTripKey(tripKey) {
  const ek = escrowKey();
  if (!ek) throw Object.assign(new Error('PHOTO_BOT_ESCROW_KEY non configurata'), { status: 500 });
  return encryptBuffer(toKeyBuffer(tripKey), ek).toString('base64');
}

/** Estrae la tripKey dall'escrow. @returns {Buffer} 32 byte */
function unwrapTripKey(escrowB64) {
  const ek = escrowKey();
  if (!ek) throw Object.assign(new Error('PHOTO_BOT_ESCROW_KEY non configurata'), { status: 500 });
  const key = decryptBuffer(Buffer.from(String(escrowB64), 'base64'), ek);
  return toKeyBuffer(key);
}

module.exports = {
  MAGIC,
  KEY_LEN,
  escrowAvailable,
  isEncrypted,
  encryptBuffer,
  decryptBuffer,
  generateTripKey,
  wrapTripKey,
  unwrapTripKey,
};
