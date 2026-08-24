/**
 * routes/trips.js — /api/trips (tutte le route richiedono autenticazione)
 */

const { Router } = require('express');
const os = require('os');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const db = require('../db');
const tripService = require('../services/tripService');
const shareService = require('../services/shareService');
const { requireAuth, requireVerifiedEmail, assertTripAccess } = require('../middleware/auth');
const { validateUpload, cleanupTempFiles, encryptionRequired } = require('../middleware/uploadGuard');

const upload = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 12,
    fields: 8,
    // I metadati delle foto cifrate (EXIF + tipo originale) viaggiano come JSON
    fieldSize: 64 * 1024,
  },
});

const userKey = req => `u${req.user.id}`;

const createTripLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: userKey,
  handler: (req, res) => res.status(429).json({ error: 'Troppi viaggi creati: riprova tra un\'ora' }),
});

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  keyGenerator: userKey,
  handler: (req, res) => res.status(429).json({ error: 'Troppi upload ravvicinati: attendi qualche minuto' }),
});

const shareCodeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: userKey,
  handler: (req, res) => res.status(429).json({ error: 'Troppe condivisioni: riprova tra un\'ora' }),
});

const placesLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: userKey,
  handler: (req, res) => res.status(429).json({ error: 'Troppe ricerche: rallenta' }),
});

const { searchPlaces, reverseGeocode, normalizeLang } = require('../services/geocode');

const router = Router();

router.use(requireAuth);
router.use(requireVerifiedEmail);

function validateId(req, res, next) {
  if (!/^\d{1,10}$/.test(req.params.id)) {
    return res.status(404).json({ error: 'Non trovato' });
  }
  next();
}

function loadAccessibleTrip(req, action = 'read') {
  const trip = db.getTripById(req.params.id);
  assertTripAccess(req.user, trip, action);
  return trip;
}

router.get('/', async (req, res, next) => {
  try {
    await tripService.ensureGeocodingBackfill();
    const rows = db.getTripsForUser(req.user.id);
    res.json(rows.map(({ trip }) => tripService.serializeTrip(trip, req.user)));
  } catch (err) { next(err); }
});

router.post('/', createTripLimiter, async (req, res, next) => {
  try {
    const trip = await tripService.createManual(req.user, req.body || {});
    res.status(201).json(tripService.serializeTrip(trip, req.user));
  } catch (err) { next(err); }
});

router.get('/places/reverse', placesLimiter, async (req, res, next) => {
  try {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    const lang = normalizeLang(req.query.lang || req.get('accept-language'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return res.json({ dest: null, country: null });
    }
    const label = await reverseGeocode(lat, lon, { lang });
    res.json(label);
  } catch (err) { next(err); }
});

router.get('/places', placesLimiter, async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    const dest = String(req.query.dest || '').trim();
    const country = String(req.query.country || '').trim();
    const field = req.query.field === 'country' ? 'country' : 'dest';
    const lang = normalizeLang(req.query.lang || req.get('accept-language'));
    if (q.length < 2) return res.json([]);

    let results;
    if (field === 'country') {
      results = dest
        ? await searchPlaces(`${dest}, ${q}`, { limit: 6, kind: 'place', lang })
        : await searchPlaces(q, { limit: 6, kind: 'country', lang });
    } else {
      const query = country ? `${q}, ${country}` : q;
      results = await searchPlaces(query, { limit: 6, kind: 'place', lang });
    }
    res.json(results);
  } catch (err) { next(err); }
});

router.get('/:id', validateId, (req, res, next) => {
  try {
    const trip = loadAccessibleTrip(req, 'read');
    res.json(tripService.serializeTrip(trip, req.user));
  } catch (err) { next(err); }
});

router.patch('/:id', validateId, async (req, res, next) => {
  try {
    const trip = loadAccessibleTrip(req, 'write');
    const updated = await tripService.updateManual(req.user, trip.id, req.body || {});
    res.json(tripService.serializeTrip(updated, req.user));
  } catch (err) { next(err); }
});

router.delete('/:id', validateId, async (req, res, next) => {
  try {
    const trip = loadAccessibleTrip(req, 'delete_trip');
    await tripService.removeTrip(trip.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/:id/photos', validateId, (req, res, next) => {
  try {
    const trip = loadAccessibleTrip(req, 'read');
    res.json(db.getPhotos(trip.id).map(p => tripService.serializePhoto(p, req.user)));
  } catch (err) { next(err); }
});

// Backup cifrato della chiave album (solo blob opaco, per sync multi-dispositivo).
router.get('/:id/key-wrap', validateId, (req, res, next) => {
  try {
    const trip = loadAccessibleTrip(req, 'read');
    const wrap = tripService.getKeyWrap(trip.id, req.user.id);
    if (!wrap) return res.status(404).json({ error: 'Wrap non disponibile' });
    res.json({ wrap });
  } catch (err) { next(err); }
});

router.put('/:id/key-wrap', validateId, async (req, res, next) => {
  try {
    const trip = loadAccessibleTrip(req, 'read');
    const wrap = req.body?.wrap;
    if (!wrap) return res.status(400).json({ error: 'Wrap obbligatorio' });
    const overwrite = req.body?.overwrite === true;
    const existing = tripService.getKeyWrap(trip.id, req.user.id);
    if (existing && !overwrite) {
      return res.json({ ok: true, kept: true });
    }
    await tripService.setKeyWrap(trip.id, req.user.id, wrap);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/photos', validateId, uploadLimiter, upload.array('photos', 12), async (req, res, next) => {
  try {
    const trip = loadAccessibleTrip(req, 'upload');
    const encrypted = req.body?.encrypted === '1';
    validateUpload(req.user, req.files, {
      encrypted,
      requireEncrypted: encryptionRequired(),
    });

    // Metadati per-file (tipo originale) inviati dal client per le foto cifrate.
    let metaList = [];
    if (encrypted && req.body?.meta) {
      try {
        const parsed = JSON.parse(req.body.meta);
        if (Array.isArray(parsed)) metaList = parsed;
      } catch { /* meta malformato: si procede senza */ }
    }

    const saved = [];
    const errors = [];
    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      try {
        const photo = await tripService.addPhotoFromWeb(trip, file, {
          caption: req.body?.caption || '',
          uploadedByUserId: req.user.id,
          clientMeta: encrypted ? (metaList[i] || {}) : null,
        });
        saved.push(tripService.serializePhoto(photo, req.user));
      } catch (err) {
        errors.push(err.status ? err.message : 'Errore di invio');
      }
    }
    if (!saved.length) {
      return res.status(502).json({ error: errors[0] || 'Upload fallito' });
    }
    res.status(201).json({ photos: saved, errors });
  } catch (err) {
    next(err);
  } finally {
    cleanupTempFiles(req.files);
  }
});

router.post('/:id/cover', validateId, async (req, res, next) => {
  try {
    const trip = loadAccessibleTrip(req, 'write');
    const photoId = req.body?.photoId ?? null;
    const updated = await tripService.setCover(trip.id, photoId === null ? null : Number(photoId));
    res.json(tripService.serializeTrip(updated, req.user));
  } catch (err) { next(err); }
});

router.post('/:id/share-codes', validateId, shareCodeLimiter, async (req, res, next) => {
  try {
    const body = req.body || {};
    const sc = await shareService.createShareCode(req.user, Number(req.params.id), {
      permission: body.permission,
      codeHash: body.codeHash,
      keyWrap: body.keyWrap,
      wrapSalt: body.wrapSalt,
    });
    res.status(201).json(shareService.serializeShareCode(sc));
  } catch (err) { next(err); }
});

router.get('/:id/share-codes', validateId, (req, res, next) => {
  try {
    const codes = shareService.listShareCodes(req.user, Number(req.params.id));
    res.json(codes);
  } catch (err) { next(err); }
});

router.get('/:id/members', validateId, (req, res, next) => {
  try {
    const members = shareService.listMembers(req.user, Number(req.params.id));
    res.json(members);
  } catch (err) { next(err); }
});

router.delete('/:id/members/:userId', validateId, async (req, res, next) => {
  try {
    if (!/^\d{1,10}$/.test(req.params.userId)) {
      return res.status(404).json({ error: 'Non trovato' });
    }
    const result = await shareService.removeMember(req.user, Number(req.params.id), Number(req.params.userId));
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
