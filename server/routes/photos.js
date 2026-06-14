/**
 * routes/photos.js — /api/photos (autenticato)
 */

const { Router } = require('express');
const db = require('../db');
const tripService = require('../services/tripService');
const { requireAuth, requireVerifiedEmail, assertPhotoAccess } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);
router.use(requireVerifiedEmail);

function validateId(req, res, next) {
  if (!/^\d{1,10}$/.test(req.params.id)) {
    return res.status(404).json({ error: 'Non trovato' });
  }
  next();
}

router.patch('/:id', validateId, async (req, res, next) => {
  try {
    const { photo } = assertPhotoAccess(req.user, db.getPhotoById(req.params.id), 'write');

    const patch = {};
    if (req.body?.note !== undefined) patch.note = String(req.body.note).slice(0, 500);
    if (req.body?.caption !== undefined) patch.caption = String(req.body.caption).slice(0, 500);
    if (!Object.keys(patch).length) {
      return res.status(400).json({ error: 'Nessun campo da aggiornare' });
    }
    const updated = await tripService.updatePhoto(photo.id, patch);
    res.json(tripService.serializePhoto(updated, req.user));
  } catch (err) { next(err); }
});

router.delete('/:id', validateId, async (req, res, next) => {
  try {
    const { photo } = assertPhotoAccess(req.user, db.getPhotoById(req.params.id), 'delete');
    await tripService.removePhoto(photo.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
