/**
 * crypto/keyStore.js — Accesso chiavi viaggio (E2E, solo client)
 */

import { clearTripKeyVault, resolveTripKey } from './tripKeyVault.js';
import { clearSessionCrypto } from './sessionCrypto.js';

export { clearTripKeyVault as clearTripKeys, prefetchTripKeys } from './tripKeyVault.js';

/**
 * Chiave AES-GCM del viaggio, oppure null se non disponibile.
 * @param {number} tripId
 * @param {{ isOwner?: boolean }} [opts]
 */
export function getTripKey(tripId, opts = {}) {
  return resolveTripKey(tripId, opts);
}

/** Logout: azzera chiavi in memoria e IndexedDB. */
export function clearAllCrypto() {
  clearSessionCrypto();
  return clearTripKeyVault();
}
