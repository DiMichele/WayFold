/**
 * sessionCrypto.js — Chiavi utente in memoria (sessione browser corrente)
 * Persistenza trasparente via deviceVault.js; si azzerano al logout.
 */

let _masterKey = null;
let _masterKeyRaw = null;
let _privateKey = null;
let _publicKeyRaw = null;

export function setSessionCrypto({ masterKey, masterKeyRaw, privateKey, publicKeyRaw }) {
  _masterKey = masterKey;
  _masterKeyRaw = masterKeyRaw instanceof Uint8Array ? masterKeyRaw : null;
  _privateKey = privateKey;
  _publicKeyRaw = publicKeyRaw instanceof Uint8Array ? publicKeyRaw : null;
}

export function clearSessionCrypto() {
  _masterKey = null;
  _masterKeyRaw = null;
  _privateKey = null;
  _publicKeyRaw = null;
}

export function getMasterKey() {
  return _masterKey;
}

export function getMasterKeyRaw() {
  return _masterKeyRaw;
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
