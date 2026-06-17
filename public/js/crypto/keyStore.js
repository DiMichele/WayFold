/**
 * crypto/keyStore.js — Accesso chiavi viaggio (E2E, solo client)
 */

import { clearTripKeyVault, resolveTripKey } from './tripKeyVault.js';
import { clearSessionCrypto } from './sessionCrypto.js';

export { clearTripKeyVault as clearTripKeys, prefetchTripKeys } from './tripKeyVault.js';

export function getTripKey(tripId, opts = {}) {
  return resolveTripKey(tripId, opts);
}

/** Logout: azzera chiavi in memoria e IndexedDB viaggi. */
export function clearAllCrypto() {
  clearSessionCrypto();
  return clearTripKeyVault();
}
