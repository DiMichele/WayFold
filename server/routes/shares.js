/**
 * routes/shares.js — Condivisione album tramite codice
 */

const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const shareService = require('../services/shareService');
const { requireAuth, requireVerifiedEmail } = require('../middleware/auth');

const userKey = req => `u${req.user.id}`;

const shareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: userKey,
  handler: (req, res) => res.status(429).json({ error: 'Troppe operazioni: riprova tra un\'ora' }),
});

const router = Router();

router.use(requireAuth);
router.use(requireVerifiedEmail);

router.post('/redeem', shareLimiter, async (req, res, next) => {
  try {
    const result = await shareService.redeemCode(req.user, req.body?.code);
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
