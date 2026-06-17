/**
 * shareService.js — Codici di condivisione album (E2E)
 *
 * Il server memorizza solo hash del codice e blob opachi (keyWrap).
 * Non conosce il codice in chiaro né la chiave dell'album.
 */

const db = require('../db');
const tripService = require('./tripService');

async function createShareCode(owner, tripId, { permission, codeHash, keyWrap, wrapSalt }) {
  const trip = db.getTripById(tripId);
  if (!trip || trip.userId !== owner.id) {
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }
  const perm = permission === 'upload' ? 'upload' : 'view';
  const hash = String(codeHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    throw Object.assign(new Error('Hash codice non valido'), { status: 400 });
  }
  if (!keyWrap || !wrapSalt) {
    throw Object.assign(new Error('Wrap chiave album obbligatorio'), { status: 400 });
  }
  if (db.codeExists(hash)) {
    throw Object.assign(new Error('Codice già in uso'), { status: 409 });
  }

  return db.createShareCode({
    tripId: trip.id,
    permission: perm,
    createdByUserId: owner.id,
    codeHash: hash,
    keyWrap: String(keyWrap),
    wrapSalt: String(wrapSalt),
  });
}

function serializeShareCode(sc) {
  return {
    id: sc.id,
    permission: sc.permission,
    createdAt: sc.createdAt,
    usedAt: sc.usedAt,
    usedByUserId: sc.usedByUserId,
    revokedAt: sc.revokedAt,
    active: !sc.usedAt && !sc.revokedAt,
    hasKeyWrap: Boolean(sc.keyWrap),
  };
}

function listShareCodes(owner, tripId) {
  const trip = db.getTripById(tripId);
  if (!trip || trip.userId !== owner.id) {
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }
  return db.getShareCodesByTrip(tripId).map(serializeShareCode);
}

async function revokeShareCode(owner, codeId) {
  const sc = db.getShareCodeById(codeId);
  if (!sc) throw Object.assign(new Error('Non trovato'), { status: 404 });
  const trip = db.getTripById(sc.tripId);
  if (!trip || trip.userId !== owner.id) {
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }
  if (sc.usedAt) {
    throw Object.assign(new Error('Codice già utilizzato'), { status: 400 });
  }
  return revokeShareCodeEntry(sc);
}

async function revokeShareCodeEntry(sc) {
  if (sc.revokedAt) return sc;
  return db.revokeShareCode(sc.id);
}

async function removeMember(owner, tripId, memberUserId) {
  const trip = db.getTripById(tripId);
  if (!trip || trip.userId !== owner.id) {
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }
  if (Number(memberUserId) === owner.id) {
    throw Object.assign(new Error('Operazione non consentita'), { status: 400 });
  }
  const ok = await db.removeTripMember(tripId, memberUserId);
  if (!ok) throw Object.assign(new Error('Non trovato'), { status: 404 });
  return { ok: true };
}

function listMembers(owner, tripId) {
  const trip = db.getTripById(tripId);
  if (!trip || trip.userId !== owner.id) {
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }
  return db.getTripMembers(tripId).map(m => {
    const u = db.getUserById(m.userId);
    return {
      userId: m.userId,
      username: u?.username || '?',
      permission: m.permission,
      joinedAt: m.joinedAt,
    };
  });
}

async function redeemCode(user, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code || code.length < 6) {
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }

  const sc = db.getShareCodeByCode(code);
  if (!sc || sc.revokedAt || sc.usedAt) {
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }
  if (!sc.keyWrap || !sc.wrapSalt) {
    throw Object.assign(new Error('Codice non valido (legacy)'), { status: 404 });
  }

  const trip = db.getTripById(sc.tripId);
  if (!trip) throw Object.assign(new Error('Non trovato'), { status: 404 });

  if (trip.userId === user.id) {
    throw Object.assign(new Error('Non puoi riscattare il codice del tuo album'), { status: 400 });
  }

  const existing = db.getTripMember(trip.id, user.id);
  if (existing) {
    return {
      alreadyMember: true,
      trip: tripService.serializeTripForUser(trip, user),
      keyWrap: sc.keyWrap,
      wrapSalt: sc.wrapSalt,
    };
  }

  await db.addTripMember({
    tripId: trip.id,
    userId: user.id,
    permission: sc.permission,
    shareCodeId: sc.id,
  });
  await db.markShareCodeUsed(sc.id, user.id);

  return {
    alreadyMember: false,
    trip: tripService.serializeTripForUser(trip, user),
    keyWrap: sc.keyWrap,
    wrapSalt: sc.wrapSalt,
  };
}

module.exports = {
  createShareCode,
  listShareCodes,
  revokeShareCode,
  removeMember,
  listMembers,
  redeemCode,
  serializeShareCode,
};
