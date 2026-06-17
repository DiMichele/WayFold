/**
 * authCrypto.js — Setup chiavi E2E al login/registrazione + auto-sblocco dispositivo
 */

import {
  createUserKeyBundle,
  setupKeysForExistingUser,
  unlockUserKeys,
  rotateKeysForPasswordChange,
} from './userKeys.js';
import { clearAllCrypto } from './keyStore.js';
import { persistDeviceSession, restoreDeviceSession, clearDeviceSession } from './deviceVault.js';

export async function cryptoOnRegister(password) {
  return createUserKeyBundle(password);
}

export async function cryptoOnLogin(password, user) {
  if (user.publicKey && user.encryptedPrivateKey && user.keySalt) {
    await unlockUserKeys(password, user);
  } else {
    const bundle = await setupKeysForExistingUser(password);
    await fetch('/api/auth/keys', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    });
  }
  await persistDeviceSession(user.id);
  return null;
}

/** Sblocco silenzioso al boot (sessione cookie + vault locale). */
export async function cryptoAutoUnlock(user) {
  if (!user?.publicKey) return true;
  return restoreDeviceSession(user);
}

export async function cryptoOnLogout(userId) {
  await clearDeviceSession(userId);
  return clearAllCrypto();
}

export async function cryptoOnPasswordChange(currentPassword, newPassword, user) {
  const keys = await rotateKeysForPasswordChange(currentPassword, newPassword, user);
  await persistDeviceSession(user.id);
  return keys;
}

/** Dopo registrazione (chiavi già in memoria). */
export async function cryptoAfterAuth(user) {
  await persistDeviceSession(user.id);
}
