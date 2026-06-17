/**
 * crypto/keyStore.js — Cache in memoria delle chiavi per-viaggio
 *
 * Le chiavi di cifratura non vengono mai persistite nel browser: vivono solo
 * in memoria per la durata della sessione e si richiedono al server (che le
 * consegna agli utenti autorizzati) la prima volta che servono. Al logout la
 * cache viene svuotata.
 */

import { b64ToBytes, importTripKey } from './photoCrypto.js';

const _keys = new Map(); // tripId → Promise<CryptoKey|null>

/** Svuota la cache delle chiavi (logout / cambio utente). */
export function clearTripKeys() {
  _keys.clear();
}

/**
 * Chiave di cifratura del viaggio come CryptoKey, oppure null se il viaggio
 * non è cifrato o l'utente non è autorizzato.
 * @returns {Promise<CryptoKey|null>}
 */
export function getTripKey(tripId) {
  const id = Number(tripId);
  if (_keys.has(id)) return _keys.get(id);

  const promise = (async () => {
    try {
      const res = await fetch(`/api/trips/${id}/crypto-key`, { credentials: 'same-origin' });
      if (!res.ok) return null;
      const body = await res.json().catch(() => null);
      if (!body?.key) return null;
      return await importTripKey(b64ToBytes(body.key));
    } catch {
      return null;
    }
  })();

  _keys.set(id, promise);
  return promise;
}
