/**
 * photoCrypto.js — Utilità formato WFENC1 (solo validazione lato server)
 *
 * La cifratura avviene esclusivamente nel browser (E2E).
 * Il server non possiede né gestisce chiavi di decifratura.
 */

const MAGIC = Buffer.from('WFENC1', 'ascii');

/** @returns {boolean} true se il buffer inizia col magic WFENC1. */
function isEncrypted(buf) {
  return Buffer.isBuffer(buf) && buf.length >= MAGIC.length && buf.subarray(0, MAGIC.length).equals(MAGIC);
}

module.exports = {
  MAGIC,
  isEncrypted,
};
