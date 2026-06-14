/**
 * routes/shareCodes.js — Revoca codici di condivisione
 */

const { Router } = require('express');
const shareService = require('../services/shareService');
const { requireAuth, requireVerifiedEmail } = require('../middleware/auth');

const router = Router();

router.use(requireAuth);
router.use(requireVerifiedEmail);

function validateId(req, res, next) {
  if (!/^\d{1,10}$/.test(req.params.id)) {
    return res.status(404).json({ error: 'Non trovato' });
  }
  next();
}

router.delete('/:id', validateId, async (req, res, next) => {
  try {
    const sc = await shareService.revokeShareCode(req.user, Number(req.params.id));
    res.json(shareService.serializeShareCode(sc));
  } catch (err) { next(err); }
});

module.exports = router;
