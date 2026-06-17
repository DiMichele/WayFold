/**
 * authCrypto.js — Setup chiavi E2E al login/registrazione
 */

import {
  createUserKeyBundle,
  setupKeysForExistingUser,
  unlockUserKeys,
  rotateKeysForPasswordChange,
} from './userKeys.js';
import { clearAllCrypto } from './keyStore.js';

export async function cryptoOnRegister(password) {
  return createUserKeyBundle(password);
}

export async function cryptoOnLogin(password, user) {
  if (user.publicKey && user.encryptedPrivateKey && user.keySalt) {
    await unlockUserKeys(password, user);
    return null;
  }
  const bundle = await setupKeysForExistingUser(password);
  await fetch('/api/auth/keys', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bundle),
  });
  return bundle;
}

export function cryptoOnLogout() {
  return clearAllCrypto();
}

export async function cryptoOnPasswordChange(currentPassword, newPassword, user) {
  return rotateKeysForPasswordChange(currentPassword, newPassword, user);
}
