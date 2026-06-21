/**
 * routes/map.js — GET /api/map/config (autenticato)
 *
 * Espone il token Mapbox al client (solo utenti loggati).
 */

const { Router } = require('express');
const config = require('../config');
const { requireAuth, requireVerifiedEmail } = require('../middleware/auth');

const router = Router();

router.get('/config', requireAuth, requireVerifiedEmail, (req, res) => {
  res.json({ token: config.MAPBOX_TOKEN || '' });
});

module.exports = router;
