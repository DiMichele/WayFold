/**
 * userKeys.js — Coppia X25519 per utente (generata al register, sbloccata col login)
 * La chiave privata viaggia al server solo cifrata con la master key (password).
 */

import { bytesToB64, b64ToBytes } from './bytes.js';
import { deriveMasterKey } from './masterKey.js';
import { sealBytes, openBytes } from './seal.js';
import { deriveMasterKey } from './masterKey.js';
import { sealBytes, openBytes } from './seal.js';
import { setSessionCrypto, getPrivateKey, getMasterKey, getPublicKeyRaw } from './sessionCrypto.js';
import { bytesToB64, b64ToBytes } from './bytes.js';
import { rewrapAllTripKeys } from './tripKeyVault.js';

const SALT_LEN = 16;

export async function createUserKeyBundle(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const masterKey = await deriveMasterKey(password, salt);
  const pair = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateKeyRaw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const encryptedPrivateKey = await sealBytes(privateKeyRaw, masterKey);

  setSessionCrypto({ masterKey, privateKey: pair.privateKey, publicKeyRaw });

  return {
    publicKey: bytesToB64(publicKeyRaw),
    encryptedPrivateKey: bytesToB64(encryptedPrivateKey),
    keySalt: bytesToB64(salt),
  };
}

export async function unlockUserKeys(password, { keySalt, encryptedPrivateKey, publicKey }) {
  if (!keySalt || !encryptedPrivateKey || !publicKey) {
    throw new Error('Chiavi E2E non configurate per questo account');
  }
  const salt = b64ToBytes(keySalt);
  const masterKey = await deriveMasterKey(password, salt);
  const privateKeyRaw = await openBytes(b64ToBytes(encryptedPrivateKey), masterKey);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyRaw,
    { name: 'X25519' },
    false,
    ['deriveKey', 'deriveBits'],
  );
  const publicKeyRaw = b64ToBytes(publicKey);
  setSessionCrypto({ masterKey, privateKey, publicKeyRaw });
}

/** Rigenera le chiavi per account legacy senza E2E. */
export async function setupKeysForExistingUser(password) {
  return createUserKeyBundle(password);
}

/** Re-cifra chiavi utente e backup viaggi dopo cambio password. */
export async function rotateKeysForPasswordChange(currentPassword, newPassword, user) {
  await unlockUserKeys(currentPassword, user);
  const privateKey = getPrivateKey();
  if (!privateKey) throw new Error('Chiavi non sbloccate');

  const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const newMk = await deriveMasterKey(newPassword, newSalt);
  const privateKeyRaw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
  const encryptedPrivateKey = await sealBytes(privateKeyRaw, newMk);

  setSessionCrypto({ masterKey: newMk, privateKey, publicKeyRaw: getPublicKeyRaw() });
  await rewrapAllTripKeys(newMk);

  return {
    publicKey: user.publicKey,
    encryptedPrivateKey: bytesToB64(encryptedPrivateKey),
    keySalt: bytesToB64(newSalt),
  };
}

/** Avvolge la tripKey (32B) con la master key per backup/sync multi-dispositivo. */
export async function wrapTripKeyForBackup(tripKeyRaw, masterKey) {
  const sealed = await sealBytes(tripKeyRaw, masterKey);
  return bytesToB64(sealed);
}

export async function unwrapTripKeyFromBackup(wrapB64, masterKey) {
  const plain = await openBytes(b64ToBytes(wrapB64), masterKey);
  if (plain.length !== 32) throw new Error('Trip key non valida');
  return plain;
}
