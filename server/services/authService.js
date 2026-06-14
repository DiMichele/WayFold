/**
 * authService.js — Registrazione, login, recupero password
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const mail = require('./mailService');
const telegram = require('./telegram');
const tripService = require('./tripService');

const BCRYPT_COST = 11;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-timing', BCRYPT_COST);
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASS_CHARS = {
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  lower: 'abcdefghjkmnpqrstuvwxyz',
  digit: '23456789',
  symbol: '!@#$%&*-_+=',
};
const VERIFY_TTL_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;

function validateUsername(username) {
  if (!USERNAME_RE.test(String(username || ''))) {
    throw Object.assign(
      new Error('Username non valido: 3-20 caratteri, solo lettere, numeri, punto e underscore'),
      { status: 400 }
    );
  }
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw Object.assign(new Error('La password deve avere almeno 8 caratteri'), { status: 400 });
  }
}

function validateEmail(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(clean) || clean.length > 254) {
    throw Object.assign(new Error('Indirizzo email non valido'), { status: 400 });
  }
  return clean;
}

function validateCredentials(username, password) {
  validateUsername(username);
  validatePassword(password);
}

function generateRandomPassword(length = 16) {
  const pools = Object.values(PASS_CHARS);
  const all = pools.join('');
  const chars = pools.map(pool => pool[crypto.randomInt(pool.length)]);
  for (let i = chars.length; i < length; i++) {
    chars.push(all[crypto.randomInt(all.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function generateVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function generateResetCode() {
  return generateVerificationCode();
}

async function issueEmailVerification(user) {
  const code = generateVerificationCode();
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();
  await db.updateUser(user.id, {
    emailVerifyCodeHash: codeHash,
    emailVerifyExpiresAt: expiresAt,
    emailVerified: false,
  });
  await mail.sendEmailVerification({ to: user.email, username: user.username, code });
}

async function register({ username, password, email }) {
  validateCredentials(username, password);
  const cleanEmail = validateEmail(email);

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const code = generateVerificationCode();
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  const expiresAt = new Date(Date.now() + VERIFY_TTL_MS).toISOString();

  const user = await db.createUser({
    username,
    passwordHash,
    email: cleanEmail,
    role: 'user',
    emailVerified: false,
    emailVerifyCodeHash: codeHash,
    emailVerifyExpiresAt: expiresAt,
  });

  try {
    await mail.sendEmailVerification({ to: cleanEmail, username: user.username, code });
  } catch (err) {
    await db.deleteUser(user.id);
    throw err;
  }

  console.log(`👤  Nuovo utente registrato (email da verificare): "${user.username}"`);
  return publicUser(user);
}

async function login({ username, password }) {
  const user = db.getUserByUsername(username);
  const hash = user ? user.passwordHash : DUMMY_HASH;
  const ok = await bcrypt.compare(String(password || ''), hash);

  if (!user || !ok) {
    console.warn(`🔒  Login fallito per "${String(username).slice(0, 30)}"`);
    throw Object.assign(new Error('Credenziali non valide'), { status: 401 });
  }
  return publicUser(user);
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = db.getUserById(userId);
  if (!user) throw Object.assign(new Error('Utente non trovato'), { status: 404 });

  const ok = await bcrypt.compare(String(currentPassword || ''), user.passwordHash);
  if (!ok) throw Object.assign(new Error('Password attuale errata'), { status: 401 });
  validatePassword(newPassword);

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await db.updateUser(user.id, { passwordHash, resetCodeHash: null, resetExpiresAt: null });
  return publicUser({ ...user, passwordHash });
}

async function updateEmail(userId, { email }) {
  const user = db.getUserById(userId);
  if (!user) throw Object.assign(new Error('Utente non trovato'), { status: 404 });
  const cleanEmail = validateEmail(email);
  const updated = await db.updateUser(user.id, { email: cleanEmail, emailVerified: false });
  try {
    await issueEmailVerification(updated);
  } catch (err) {
    throw err;
  }
  return publicUser(db.getUserById(userId));
}

async function verifyEmail(userId, { code }) {
  const user = db.getUserById(userId);
  if (!user) throw Object.assign(new Error('Utente non trovato'), { status: 404 });
  if (user.emailVerified) return publicUser(user);

  const genericErr = Object.assign(new Error('Codice non valido o scaduto'), { status: 400 });
  if (!user.emailVerifyCodeHash || !user.emailVerifyExpiresAt) throw genericErr;
  if (Date.now() > new Date(user.emailVerifyExpiresAt).getTime()) {
    await db.updateUser(user.id, { emailVerifyCodeHash: null, emailVerifyExpiresAt: null });
    throw genericErr;
  }

  const ok = await bcrypt.compare(String(code || '').trim(), user.emailVerifyCodeHash);
  if (!ok) throw genericErr;

  const updated = await db.updateUser(user.id, {
    emailVerified: true,
    emailVerifyCodeHash: null,
    emailVerifyExpiresAt: null,
  });

  const totalUsers = db.countUsers();
  console.log(`✓  Email verificata: "${updated.username}"`);
  await telegram.notifyUserRegistered({ username: updated.username, totalUsers });

  return publicUser(updated);
}

async function resendEmailVerification(userId) {
  const user = db.getUserById(userId);
  if (!user) throw Object.assign(new Error('Utente non trovato'), { status: 404 });
  if (user.emailVerified) {
    return { ok: true, message: 'Email già verificata' };
  }
  if (!user.email) {
    throw Object.assign(new Error('Nessuna email registrata'), { status: 400 });
  }
  await issueEmailVerification(user);
  return { ok: true, message: 'Nuovo codice inviato via email' };
}

/**
 * Richiesta reset self-service: invia codice via email (valido 15 minuti).
 */
async function requestPasswordReset({ username }) {
  validateUsername(username);
  const user = db.getUserByUsername(username);

  if (!user?.email || !user.emailVerified) {
    await bcrypt.compare('dummy', DUMMY_HASH);
    return {
      ok: true,
      message: 'Se l\'account esiste, riceverai un codice via email entro pochi minuti.',
    };
  }

  const code = generateResetCode();
  const codeHash = await bcrypt.hash(code, BCRYPT_COST);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

  try {
    await mail.sendPasswordResetEmail({ to: user.email, username: user.username, code });
  } catch (err) {
    throw err;
  }

  await db.updateUser(user.id, { resetCodeHash: codeHash, resetExpiresAt: expiresAt });

  return {
    ok: true,
    message: 'Se l\'account esiste, riceverai un codice via email entro pochi minuti.',
  };
}

/**
 * Reset password da bot admin: genera password temporanea e la invia via email.
 */
async function resetPasswordByAdmin({ username }) {
  validateUsername(username);
  const user = db.getUserByUsername(username);

  if (!user) throw Object.assign(new Error('Utente non trovato'), { status: 404 });
  if (!user.email) throw Object.assign(new Error('Nessuna email registrata per questo account'), { status: 400 });
  if (!user.emailVerified) throw Object.assign(new Error('Email non ancora verificata'), { status: 400 });

  const newPassword = generateRandomPassword();
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);

  try {
    await mail.sendAdminPasswordResetEmail({ to: user.email, username: user.username, password: newPassword });
  } catch (err) {
    throw err;
  }

  await db.updateUser(user.id, {
    passwordHash,
    resetCodeHash: null,
    resetExpiresAt: null,
  });

  return {
    ok: true,
    message: `Password reimpostata. La nuova password è stata inviata a ${user.email}.`,
  };
}

async function resetPassword({ username, code, newPassword }) {
  validateUsername(username);
  validatePassword(newPassword);

  const user = db.getUserByUsername(username);
  const genericErr = Object.assign(new Error('Codice non valido o scaduto'), { status: 400 });

  if (!user?.resetCodeHash || !user.resetExpiresAt) throw genericErr;
  if (Date.now() > new Date(user.resetExpiresAt).getTime()) {
    await db.updateUser(user.id, { resetCodeHash: null, resetExpiresAt: null });
    throw genericErr;
  }

  const ok = await bcrypt.compare(String(code || '').trim(), user.resetCodeHash);
  if (!ok) throw genericErr;

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await db.updateUser(user.id, {
    passwordHash,
    resetCodeHash: null,
    resetExpiresAt: null,
  });
  return publicUser({ ...user, passwordHash, emailVerified: user.emailVerified });
}

/**
 * Elimina l'account e tutti i viaggi/foto dell'utente (db, filesystem, Telegram).
 */
async function purgeUserAccount(userId) {
  const user = db.getUserById(userId);
  if (!user) throw Object.assign(new Error('Utente non trovato'), { status: 404 });

  const trips = db.getTripsByUser(userId);
  const photoCount = trips.reduce((n, t) => n + db.getPhotos(t.id).length, 0);
  for (const trip of trips) {
    await tripService.removeTrip(trip.id);
  }

  if (user.email) {
    try {
      await mail.sendAccountDeletedEmail({ to: user.email, username: user.username });
    } catch (err) {
      console.error(`⚠️  Email eliminazione account non inviata a "${user.username}":`, err.message);
    }
  }

  const removed = await db.deleteUser(userId);
  if (!removed) throw Object.assign(new Error('Utente non trovato'), { status: 404 });

  console.log(`🗑️  Account eliminato: "${user.username}" (${trips.length} viaggi, ${photoCount} foto)`);
  return { username: user.username, trips: trips.length, photos: photoCount };
}

async function deleteAccount(userId, { password }) {
  const user = db.getUserById(userId);
  if (!user) throw Object.assign(new Error('Utente non trovato'), { status: 404 });

  const ok = await bcrypt.compare(String(password || ''), user.passwordHash);
  if (!ok) throw Object.assign(new Error('Password errata'), { status: 401 });

  await purgeUserAccount(userId);
  return { ok: true };
}

/** Eliminazione da bot Telegram (solo admin del gruppo). */
async function deleteAccountByUsername(username) {
  validateUsername(username);
  const user = db.getUserByUsername(username);
  if (!user) throw Object.assign(new Error('Utente non trovato'), { status: 404 });
  return purgeUserAccount(user.id);
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email || null,
    emailVerified: Boolean(user.emailVerified),
    role: user.role,
  };
}

module.exports = {
  register,
  login,
  changePassword,
  updateEmail,
  verifyEmail,
  resendEmailVerification,
  requestPasswordReset,
  resetPasswordByAdmin,
  resetPassword,
  deleteAccount,
  deleteAccountByUsername,
  publicUser,
};
