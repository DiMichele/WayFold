/**
 * sessionCrypto.js — Chiavi utente in memoria per la sessione corrente
 * Mai persistite su disco: si azzerano al logout.
 */

let _masterKey = null;
let _privateKey = null;
let _publicKeyRaw = null;

export function setSessionCrypto({ masterKey, privateKey, publicKeyRaw }) {
  _masterKey = masterKey;
  _privateKey = privateKey;
  _publicKeyRaw = publicKeyRaw instanceof Uint8Array ? publicKeyRaw : null;
}

export function clearSessionCrypto() {
  _masterKey = null;
  _privateKey = null;
  _publicKeyRaw = null;
}

export function getMasterKey() {
  return _masterKey;
}

export function getPrivateKey() {
  return _privateKey;
}

export function getPublicKeyRaw() {
  return _publicKeyRaw;
}

export function sessionReady() {
  return Boolean(_masterKey);
}
