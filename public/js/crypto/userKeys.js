/**
 * userKeys.js — Coppia X25519 per utente (generata al register, sbloccata col login)
 * La chiave privata viaggia al server solo cifrata con la master key (password).
 */

import { bytesToB64, b64ToBytes } from './bytes.js';
import { deriveMasterKeyMaterial, importMasterKey } from './masterKey.js';
import { sealBytes, openBytes } from './seal.js';
import { setSessionCrypto, getPrivateKey, getPublicKeyRaw } from './sessionCrypto.js';
import { rewrapAllTripKeys } from './tripKeyVault.js';

const SALT_LEN = 16;

async function loadSessionFromPassword(password, salt, encryptedPrivateKeyB64, publicKeyB64) {
  const rawMk = await deriveMasterKeyMaterial(password, salt);
  const masterKey = await importMasterKey(rawMk);
  const privateKeyRaw = await openBytes(b64ToBytes(encryptedPrivateKeyB64), masterKey);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyRaw,
    { name: 'X25519' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const publicKeyRaw = b64ToBytes(publicKeyB64);
  setSessionCrypto({ masterKey, masterKeyRaw: rawMk, privateKey, publicKeyRaw });
}

export async function createUserKeyBundle(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const rawMk = await deriveMasterKeyMaterial(password, salt);
  const masterKey = await importMasterKey(rawMk);
  const pair = await crypto.subtle.generateKey(
    { name: 'X25519' },
    true,
    ['deriveKey', 'deriveBits'],
  );
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const privateKeyRaw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const encryptedPrivateKey = await sealBytes(privateKeyRaw, masterKey);

  setSessionCrypto({ masterKey, masterKeyRaw: rawMk, privateKey: pair.privateKey, publicKeyRaw });

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
  await loadSessionFromPassword(password, b64ToBytes(keySalt), encryptedPrivateKey, publicKey);
}

export async function setupKeysForExistingUser(password) {
  return createUserKeyBundle(password);
}

export async function rotateKeysForPasswordChange(currentPassword, newPassword, user) {
  await unlockUserKeys(currentPassword, user);
  const privateKey = getPrivateKey();
  if (!privateKey) throw new Error('Chiavi non sbloccate');

  const newSalt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const rawMk = await deriveMasterKeyMaterial(newPassword, newSalt);
  const newMk = await importMasterKey(rawMk);
  const privateKeyRaw = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
  const encryptedPrivateKey = await sealBytes(privateKeyRaw, newMk);

  setSessionCrypto({ masterKey: newMk, masterKeyRaw: rawMk, privateKey, publicKeyRaw: getPublicKeyRaw() });
  await rewrapAllTripKeys(newMk);

  return {
    publicKey: user.publicKey,
    encryptedPrivateKey: bytesToB64(encryptedPrivateKey),
    keySalt: bytesToB64(newSalt),
  };
}

export async function wrapTripKeyForBackup(tripKeyRaw, masterKey) {
  const sealed = await sealBytes(tripKeyRaw, masterKey);
  return bytesToB64(sealed);
}

export async function unwrapTripKeyFromBackup(wrapB64, masterKey) {
  const plain = await openBytes(b64ToBytes(wrapB64), masterKey);
  if (plain.length !== 32) throw new Error('Trip key non valida');
  return plain;
}
