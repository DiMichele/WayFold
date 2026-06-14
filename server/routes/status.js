/**
 * routes/status.js — GET /api/status (autenticato)
 *
 * Conteggi SOLO dell'utente corrente: usati dal frontend per la sync
 * automatica. Include lo stato Telegram per il sync gate.
 */

const { Router } = require('express');
const db = require('../db');
const telegram = require('../services/telegram');
const { requireAuth, requireVerifiedEmail } = require('../middleware/auth');

const router = Router();

router.get('/', requireAuth, requireVerifiedEmail, async (req, res) => {
  try {
    const trips = db.getTripsForUser(req.user.id).map(r => r.trip);
    const photos = trips.reduce((n, t) => n + db.getPhotos(t.id).length, 0);
    const body = { ok: true, trips: trips.length, photos };
    body.telegram = await telegram.probe();
    body.uptime = Math.round(process.uptime());
    res.json(body);
  } catch {
    res.status(500).json({ ok: false, error: 'Errore interno' });
  }
});

module.exports = router;
