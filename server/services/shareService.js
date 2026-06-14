/**
 * shareService.js — Codici di condivisione album
 */

const crypto = require('crypto');
const db = require('../db');
const tripService = require('./tripService');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;

function generateCode() {
  const bytes = crypto.randomBytes(CODE_LEN);
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length];
  }
  return code;
}

async function createShareCode(owner, tripId, permission) {
  const trip = db.getTripById(tripId);
  if (!trip || trip.userId !== owner.id) {
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }
  const perm = permission === 'upload' ? 'upload' : 'view';

  let code;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
  } while (db.codeExists(code) && attempts < 20);

  if (db.codeExists(code)) {
    throw Object.assign(new Error('Impossibile generare codice'), { status: 500 });
  }

  return db.createShareCode({
    tripId: trip.id,
    code,
    permission: perm,
    createdByUserId: owner.id,
  });
}

function serializeShareCode(sc) {
  return {
    id: sc.id,
    code: sc.code,
    permission: sc.permission,
    createdAt: sc.createdAt,
    usedAt: sc.usedAt,
    usedByUserId: sc.usedByUserId,
    revokedAt: sc.revokedAt,
    active: !sc.usedAt && !sc.revokedAt,
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
