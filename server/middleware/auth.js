/**
 * middleware/auth.js — Autenticazione e ownership
 */

const db = require('../db');

/** Richiede sessione valida; popola req.user (oggetto db completo). */
function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Accesso richiesto' });
  }
  const user = db.getUserById(userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Accesso richiesto' });
  }
  req.user = user;
  next();
}

/**
 * Verifica che la risorsa appartenga all'utente.
 * Risorsa altrui o inesistente → 404 IDENTICO (niente information leak).
 */
function assertOwnership(user, resource) {
  if (!resource || resource.userId !== user.id) {
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }
  return resource;
}

/** Contesto accesso a un viaggio per l'utente corrente. */
function getTripAccess(user, trip) {
  if (!trip) return null;
  if (trip.userId === user.id) {
    return { trip, isOwner: true, permission: 'owner' };
  }
  const member = db.getTripMember(trip.id, user.id);
  if (!member) return null;
  return { trip, isOwner: false, permission: member.permission };
}

/**
 * Verifica accesso a un viaggio.
 * action: read | write | upload | delete_trip
 */
function assertTripAccess(user, trip, action = 'read') {
  const access = getTripAccess(user, trip);
  if (!access) throw Object.assign(new Error('Non trovato'), { status: 404 });

  if (action === 'delete_trip') {
    if (!access.isOwner) throw Object.assign(new Error('Non trovato'), { status: 404 });
    return access;
  }

  if (action === 'read') return access;

  if (action === 'upload') {
    if (access.isOwner || access.permission === 'upload') return access;
    throw Object.assign(new Error('Non trovato'), { status: 404 });
  }

  // write: PATCH trip, PATCH photo, cover, notes
  if (access.isOwner || access.permission === 'upload') return access;
  throw Object.assign(new Error('Non trovato'), { status: 404 });
}

function canDeletePhoto(user, photo, trip) {
  const access = getTripAccess(user, trip);
  if (!access || !photo) return false;
  if (access.isOwner) return true;
  if (access.permission !== 'upload') return false;
  const uploader = photo.uploadedByUserId ?? trip.userId;
  return uploader === user.id;
}

/** Ownership di una foto: proprietario o membro con permessi adeguati. */
function assertPhotoAccess(user, photo, action = 'read') {
  if (!photo) throw Object.assign(new Error('Non trovato'), { status: 404 });
  const trip = db.getTripById(photo.tripId);
  if (!trip) throw Object.assign(new Error('Non trovato'), { status: 404 });

  if (action === 'delete') {
    if (!canDeletePhoto(user, photo, trip)) {
      throw Object.assign(new Error('Non trovato'), { status: 404 });
    }
    return { photo, trip, access: getTripAccess(user, trip) };
  }

  assertTripAccess(user, trip, action === 'write' ? 'write' : 'read');
  return { photo, trip, access: getTripAccess(user, trip) };
}

/** @deprecated usa assertTripAccess */
function assertPhotoOwnership(user, photo) {
  return assertPhotoAccess(user, photo, 'write').photo;
}

/** Richiede email verificata (dopo requireAuth). */
function requireVerifiedEmail(req, res, next) {
  if (!req.user?.emailVerified) {
    return res.status(403).json({ error: 'Verifica la tua email per continuare', code: 'EMAIL_NOT_VERIFIED' });
  }
  next();
}

module.exports = {
  requireAuth,
  requireVerifiedEmail,
  assertOwnership,
  assertPhotoOwnership,
  assertTripAccess,
  assertPhotoAccess,
  getTripAccess,
  canDeletePhoto,
};
