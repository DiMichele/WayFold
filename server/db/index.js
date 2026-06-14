/**
 * db/index.js — Persistenza JSON locale
 *
 * Layer dati isolato: il resto dell'app non sa come vengono salvati i dati.
 * In futuro si può sostituire con Postgres/Supabase modificando solo questo file.
 *
 * Garanzie:
 *  - write-lock in memoria: le scritture si accodano (album Telegram = 10 foto simultanee)
 *  - scrittura atomica: write su .tmp + rename, mai file corrotti a metà
 */

const fs = require('fs');
const config = require('../config');
const { canonicalEmail } = require('../utils/email');

const DB_PATH = config.DB_PATH;

const EMPTY = () => ({
  _nextTripId: 1,
  _nextPhotoId: 1,
  _nextUserId: 1,
  _nextShareCodeId: 1,
  users: [],
  trips: [],
  photos: [],
  shareCodes: [],
  tripMembers: [],
});

// ─── Write-lock ────────────────────────────────────────────────────────────

let _lock = Promise.resolve();

function withLock(fn) {
  const run = _lock.then(fn, fn);
  _lock = run.then(() => {}, () => {});
  return run;
}

// ─── Persistenza ───────────────────────────────────────────────────────────

function load() {
  if (!fs.existsSync(DB_PATH)) {
    const initial = EMPTY();
    save(initial);
    return initial;
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    // Migrazione campi multi-utente per db creati prima
    if (!Array.isArray(data.users)) data.users = [];
    if (!data._nextUserId) data._nextUserId = 1;
    for (const user of data.users) {
      if (user.email === undefined) user.email = null;
      if (user.resetCodeHash === undefined) user.resetCodeHash = null;
      if (user.resetExpiresAt === undefined) user.resetExpiresAt = null;
      if (user.emailVerified === undefined) user.emailVerified = true;
      if (user.emailVerifyCodeHash === undefined) user.emailVerifyCodeHash = null;
      if (user.emailVerifyExpiresAt === undefined) user.emailVerifyExpiresAt = null;
    }
    for (const photo of data.photos || []) {
      if (photo.fileId === undefined) photo.fileId = null;
    }
    for (const user of data.users) {
      if (user.role === 'owner') user.role = 'user';
    }
    if (!Array.isArray(data.shareCodes)) data.shareCodes = [];
    if (!Array.isArray(data.tripMembers)) data.tripMembers = [];
    if (!data._nextShareCodeId) data._nextShareCodeId = 1;
    const tripOwnerById = new Map((data.trips || []).map(t => [t.id, t.userId]));
    for (const photo of data.photos || []) {
      if (photo.uploadedByUserId == null) {
        photo.uploadedByUserId = tripOwnerById.get(photo.tripId) ?? null;
      }
    }
    // Migrazione: dest/name non devono conservare il prefisso [username] dei topic Telegram
    const topicPrefix = /^\[[a-zA-Z0-9_.]{3,20}\]\s*/;
    let tripsSanitized = false;
    for (const trip of data.trips || []) {
      const cleanDest = String(trip.dest || '').trim().replace(topicPrefix, '');
      const cleanName = String(trip.name || '').trim().replace(topicPrefix, '');
      if (cleanDest && cleanDest !== trip.dest) {
        trip.dest = cleanDest;
        tripsSanitized = true;
      }
      if (cleanName && cleanName !== trip.name) {
        trip.name = cleanName;
        tripsSanitized = true;
      }
    }
    if (tripsSanitized) save(data);
    return data;
  } catch {
    console.error('⚠️  db.json corrotto — ricreato da zero');
    const fresh = EMPTY();
    save(fresh);
    return fresh;
  }
}

function save(data) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

// ─── Users ─────────────────────────────────────────────────────────────────

function getUserById(id) {
  return load().users.find(u => u.id === Number(id)) || null;
}

function getUserByUsername(username) {
  const q = String(username || '').trim().toLowerCase();
  return load().users.find(u => u.username.toLowerCase() === q) || null;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isEmailTaken(email, excludeUserId = null) {
  const canon = canonicalEmail(email);
  if (!canon) return false;
  return load().users.some(u =>
    u.email && canonicalEmail(u.email) === canon && u.id !== Number(excludeUserId)
  );
}

function getUserByEmail(email) {
  const canon = canonicalEmail(email);
  if (!canon) return null;
  return load().users.find(u => u.email && canonicalEmail(u.email) === canon) || null;
}

function countUsers() {
  return load().users.length;
}

function getAllUsers() {
  return [...load().users].sort((a, b) => a.username.localeCompare(b.username, 'it'));
}

/** Cerca per username o email (match parziale, case-insensitive). */
function searchUsers(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return getAllUsers().filter(u => {
    const email = (u.email || '').toLowerCase();
    return u.username.toLowerCase().includes(q) || email.includes(q);
  });
}

async function createUser({
  username, passwordHash, email = null, role = 'user',
  emailVerified = false, emailVerifyCodeHash = null, emailVerifyExpiresAt = null,
}) {
  return withLock(() => {
    const data = load();
    const clean = String(username).trim();
    if (data.users.some(u => u.username.toLowerCase() === clean.toLowerCase())) {
      throw Object.assign(new Error('Username già in uso'), { status: 409 });
    }
    const cleanEmail = email ? normalizeEmail(email) : null;
    if (cleanEmail && isEmailTaken(cleanEmail)) {
      throw Object.assign(new Error('Email già registrata'), { status: 409 });
    }
    const user = {
      id: data._nextUserId++,
      username: clean,
      email: cleanEmail,
      passwordHash,
      role,
      emailVerified: Boolean(emailVerified),
      emailVerifyCodeHash,
      emailVerifyExpiresAt,
      resetCodeHash: null,
      resetExpiresAt: null,
      createdAt: new Date().toISOString(),
    };
    data.users.push(user);
    save(data);
    return user;
  });
}

async function updateUser(id, patch) {
  return withLock(() => {
    const data = load();
    const user = data.users.find(u => u.id === Number(id));
    if (!user) return null;
    if (patch.passwordHash !== undefined) user.passwordHash = patch.passwordHash;
    if (patch.email !== undefined) {
      const cleanEmail = patch.email ? normalizeEmail(patch.email) : null;
      if (cleanEmail && isEmailTaken(cleanEmail, user.id)) {
        throw Object.assign(new Error('Email già in uso'), { status: 409 });
      }
      user.email = cleanEmail;
    }
    if (patch.resetCodeHash !== undefined) user.resetCodeHash = patch.resetCodeHash;
    if (patch.resetExpiresAt !== undefined) user.resetExpiresAt = patch.resetExpiresAt;
    if (patch.emailVerified !== undefined) user.emailVerified = Boolean(patch.emailVerified);
    if (patch.emailVerifyCodeHash !== undefined) user.emailVerifyCodeHash = patch.emailVerifyCodeHash;
    if (patch.emailVerifyExpiresAt !== undefined) user.emailVerifyExpiresAt = patch.emailVerifyExpiresAt;
    save(data);
    return user;
  });
}

// ─── Trips ─────────────────────────────────────────────────────────────────

function getAllTrips() {
  return load().trips;
}

function getTripsByUser(userId) {
  return load().trips.filter(t => t.userId === Number(userId));
}

/** Viaggi propri + condivisi tramite tripMembers. */
function getTripsForUser(userId) {
  const uid = Number(userId);
  const data = load();
  const ownedIds = new Set(data.trips.filter(t => t.userId === uid).map(t => t.id));
  const memberByTrip = new Map();
  for (const m of data.tripMembers) {
    if (m.userId === uid) memberByTrip.set(m.tripId, m);
  }
  const trips = [];
  for (const t of data.trips) {
    if (ownedIds.has(t.id)) {
      trips.push({ trip: t, isOwner: true, sharedPermission: null });
    } else if (memberByTrip.has(t.id)) {
      const mem = memberByTrip.get(t.id);
      trips.push({ trip: t, isOwner: false, sharedPermission: mem.permission });
    }
  }
  return trips;
}

function getTripMember(tripId, userId) {
  const tid = Number(tripId);
  const uid = Number(userId);
  return load().tripMembers.find(m => m.tripId === tid && m.userId === uid) || null;
}

function getTripMembers(tripId) {
  return load().tripMembers.filter(m => m.tripId === Number(tripId));
}

function getTripById(id) {
  return load().trips.find(t => t.id === Number(id)) || null;
}

function getTripByTopicId(topicId) {
  return load().trips.find(t => t.topicId != null && String(t.topicId) === String(topicId)) || null;
}

/** Trova un viaggio per nome/destinazione (case-insensitive, match esatto). */
function findTripByName(name) {
  const q = String(name).trim().toLowerCase();
  return load().trips.find(t =>
    (t.dest || '').toLowerCase() === q || (t.name || '').toLowerCase() === q
  ) || null;
}

async function createTrip(fields) {
  return withLock(() => {
    const data = load();

    // Doppio controllo dentro il lock: evita duplicati da eventi paralleli
    if (fields.topicId != null) {
      const existing = data.trips.find(t => String(t.topicId) === String(fields.topicId));
      if (existing) return existing;
    }

    const now = new Date().toISOString();
    const trip = {
      id: data._nextTripId++,
      userId: fields.userId != null ? Number(fields.userId) : null,
      topicId: fields.topicId != null ? String(fields.topicId) : null,
      name: (fields.name || fields.dest || '').trim(),
      dest: (fields.dest || fields.name || '').trim(),
      country: fields.country || null,
      countryCode: fields.countryCode || null,
      flag: fields.flag || null,
      continent: fields.continent || null,
      lat: fields.lat ?? null,
      lon: fields.lon ?? null,
      year: fields.year ?? null,
      month: fields.month ?? null,
      days: fields.days ?? null,
      type: fields.type || null,
      tags: Array.isArray(fields.tags) ? fields.tags : [],
      scene: fields.scene || 'coast',
      createdAt: now,
      updatedAt: now,
    };
    data.trips.push(trip);
    save(data);
    return trip;
  });
}

async function updateTrip(id, patch) {
  return withLock(() => {
    const data = load();
    const trip = data.trips.find(t => t.id === Number(id));
    if (!trip) return null;
    Object.assign(trip, patch, { id: trip.id, updatedAt: new Date().toISOString() });
    save(data);
    return trip;
  });
}

async function deleteUser(id) {
  return withLock(() => {
    const data = load();
    const userId = Number(id);
    const before = data.users.length;
    data.users = data.users.filter(u => u.id !== userId);
    if (data.users.length === before) return false;
    save(data);
    return true;
  });
}

/** Elimina il viaggio e le sue foto dal db. Ritorna le foto rimosse (per cancellare i file). */
async function deleteTrip(id) {
  return withLock(() => {
    const data = load();
    const tripId = Number(id);
    const trip = data.trips.find(t => t.id === tripId);
    if (!trip) return null;
    const removedPhotos = data.photos.filter(p => p.tripId === tripId);
    data.trips = data.trips.filter(t => t.id !== tripId);
    data.photos = data.photos.filter(p => p.tripId !== tripId);
    data.shareCodes = data.shareCodes.filter(s => s.tripId !== tripId);
    data.tripMembers = data.tripMembers.filter(m => m.tripId !== tripId);
    save(data);
    return { trip, removedPhotos };
  });
}

// ─── Photos ────────────────────────────────────────────────────────────────

function getPhotos(tripId) {
  return load().photos
    .filter(p => p.tripId === Number(tripId))
    .sort((a, b) => a.date - b.date);
}

function getPhotoById(id) {
  return load().photos.find(p => p.id === Number(id)) || null;
}

function getPhotoByFile(tripId, fileName) {
  const tid = Number(tripId);
  const name = String(fileName || '');
  return load().photos.find(p => p.tripId === tid && p.fileName === name) || null;
}

async function addPhoto({
  tripId, fileName, fileId, caption, note, msgId, date, takenAt, lat, lon, size,
  uploadedByUserId = null,
}) {
  return withLock(() => {
    const data = load();
    const trip = data.trips.find(t => t.id === Number(tripId));
    const uploader = uploadedByUserId != null
      ? Number(uploadedByUserId)
      : (trip?.userId ?? null);
    const photo = {
      id: data._nextPhotoId++,
      tripId: Number(tripId),
      fileName,
      fileId: fileId ?? null,
      caption: caption || '',
      note: note || '',
      msgId: msgId ?? null,
      date: date ?? Math.floor(Date.now() / 1000),
      takenAt: takenAt || null,
      lat: lat ?? null,
      lon: lon ?? null,
      size: size ?? null,
      uploadedByUserId: uploader,
      addedAt: new Date().toISOString(),
    };
    data.photos.push(photo);
    save(data);
    return photo;
  });
}

/** Uso disco e numero foto caricati da un utente (quota personale). */
function getUserUsage(userId) {
  const uid = Number(userId);
  const data = load();
  const tripOwnerById = new Map(data.trips.map(t => [t.id, t.userId]));
  let bytes = 0, count = 0;
  for (const p of data.photos) {
    const uploader = p.uploadedByUserId ?? tripOwnerById.get(p.tripId) ?? null;
    if (uploader === uid) { count++; bytes += p.size || 0; }
  }
  return { bytes, count };
}

async function updatePhoto(id, patch) {
  return withLock(() => {
    const data = load();
    const photo = data.photos.find(p => p.id === Number(id));
    if (!photo) return null;
    if (patch.note !== undefined) photo.note = String(patch.note || '').trim();
    if (patch.caption !== undefined) photo.caption = String(patch.caption || '').trim();
    photo.updatedAt = new Date().toISOString();
    save(data);
    return photo;
  });
}

/** Elimina una foto dal db. Ritorna la foto rimossa (per cancellare il file). */
async function deletePhoto(id) {
  return withLock(() => {
    const data = load();
    const photo = data.photos.find(p => p.id === Number(id));
    if (!photo) return null;
    data.photos = data.photos.filter(p => p.id !== Number(id));
    save(data);
    return photo;
  });
}

// ─── Share codes & members ─────────────────────────────────────────────────

function getShareCodeByCode(code) {
  const q = String(code || '').trim().toUpperCase();
  if (!q) return null;
  return load().shareCodes.find(s => s.code === q) || null;
}

function getShareCodeById(id) {
  return load().shareCodes.find(s => s.id === Number(id)) || null;
}

function getShareCodesByTrip(tripId) {
  return load().shareCodes
    .filter(s => s.tripId === Number(tripId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function createShareCode({ tripId, code, permission, createdByUserId }) {
  return withLock(() => {
    const data = load();
    const entry = {
      id: data._nextShareCodeId++,
      tripId: Number(tripId),
      code: String(code).toUpperCase(),
      permission: permission === 'upload' ? 'upload' : 'view',
      createdByUserId: Number(createdByUserId),
      createdAt: new Date().toISOString(),
      usedAt: null,
      usedByUserId: null,
      revokedAt: null,
    };
    data.shareCodes.push(entry);
    save(data);
    return entry;
  });
}

async function markShareCodeUsed(id, userId) {
  return withLock(() => {
    const data = load();
    const sc = data.shareCodes.find(s => s.id === Number(id));
    if (!sc) return null;
    sc.usedAt = new Date().toISOString();
    sc.usedByUserId = Number(userId);
    save(data);
    return sc;
  });
}

async function revokeShareCode(id) {
  return withLock(() => {
    const data = load();
    const sc = data.shareCodes.find(s => s.id === Number(id));
    if (!sc) return null;
    sc.revokedAt = new Date().toISOString();
    save(data);
    return sc;
  });
}

async function addTripMember({ tripId, userId, permission, shareCodeId }) {
  return withLock(() => {
    const data = load();
    const tid = Number(tripId);
    const uid = Number(userId);
    const existing = data.tripMembers.find(m => m.tripId === tid && m.userId === uid);
    if (existing) return existing;
    const member = {
      tripId: tid,
      userId: uid,
      permission: permission === 'upload' ? 'upload' : 'view',
      joinedAt: new Date().toISOString(),
      shareCodeId: shareCodeId != null ? Number(shareCodeId) : null,
    };
    data.tripMembers.push(member);
    save(data);
    return member;
  });
}

async function removeTripMember(tripId, userId) {
  return withLock(() => {
    const data = load();
    const tid = Number(tripId);
    const uid = Number(userId);
    const before = data.tripMembers.length;
    data.tripMembers = data.tripMembers.filter(m => !(m.tripId === tid && m.userId === uid));
    if (data.tripMembers.length === before) return false;
    save(data);
    return true;
  });
}

function codeExists(code) {
  return Boolean(getShareCodeByCode(code));
}

module.exports = {
  getUserById,
  getUserByUsername,
  getUserByEmail,
  countUsers,
  getAllUsers,
  searchUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserUsage,
  getAllTrips,
  getTripsByUser,
  getTripsForUser,
  getTripMember,
  getTripMembers,
  getTripById,
  getTripByTopicId,
  findTripByName,
  createTrip,
  updateTrip,
  deleteTrip,
  getPhotos,
  getPhotoById,
  getPhotoByFile,
  addPhoto,
  updatePhoto,
  deletePhoto,
  getShareCodeByCode,
  getShareCodeById,
  getShareCodesByTrip,
  createShareCode,
  markShareCodeUsed,
  revokeShareCode,
  addTripMember,
  removeTripMember,
  codeExists,
};
