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
import {
  persistDeviceSession, restoreDeviceSession, clearDeviceSession, consumeSessionHop,
} from './deviceVault.js';
import { sessionReady } from './sessionCrypto.js';

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

/** Sblocco silenzioso al boot (hop login → app, poi vault locale). */
export async function cryptoAutoUnlock(user) {
  if (!user?.publicKey) return true;
  if (await consumeSessionHop()) {
    await persistDeviceSession(user.id);
    return true;
  }
  return restoreDeviceSession(user);
}

/** Sblocco esplicito con password (nuovo dispositivo / PWA / vault vuoto). */
export async function cryptoUnlockWithPassword(password, user) {
  if (!user?.publicKey || !user.encryptedPrivateKey || !user.keySalt) {
    const bundle = await setupKeysForExistingUser(password);
    await fetch('/api/auth/keys', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bundle),
    });
    await persistDeviceSession(user.id);
    return true;
  }
  await unlockUserKeys(password, user);
  await persistDeviceSession(user.id);
  return sessionReady();
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
