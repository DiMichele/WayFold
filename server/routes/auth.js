/**
 * routes/auth.js — /api/auth
 *
 *   POST /api/auth/register         { username, password, email }
 *   POST /api/auth/login            { username, password }
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 *   POST /api/auth/password         { currentPassword, newPassword }
 *   POST /api/auth/email           { email }
 *   POST /api/auth/forgot-password  { username }
 *   POST /api/auth/reset-password   { username, code, newPassword }
 *   POST /api/auth/verify-email     { code }
 *   POST /api/auth/resend-verification
 *   DELETE /api/auth/account        { password }
 */

const { Router } = require('express');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const authService = require('../services/authService');
const { requireAuth } = require('../middleware/auth');

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: req => `${ipKeyGenerator(req.ip)}|${String(req.body?.username || '').toLowerCase().slice(0, 30)}`,
  handler: (req, res) => {
    console.warn(`🔒  Rate limit login superato da ${req.ip}`);
    res.status(429).json({ error: 'Troppi tentativi: riprova tra 15 minuti' });
  },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  keyGenerator: ipKeyGenerator,
  // Conta solo registrazioni riuscite (201), non errori di validazione o username occupato
  skipFailedRequests: true,
  handler: (req, res) => {
    console.warn(`🔒  Rate limit registrazioni superato da ${req.ip}`);
    res.status(429).json({ error: 'Troppe registrazioni da questo dispositivo: riprova più tardi' });
  },
});

const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyGenerator: req => `${ipKeyGenerator(req.ip)}|${String(req.body?.username || '').toLowerCase().slice(0, 30)}`,
  handler: (req, res) => res.status(429).json({ error: 'Troppe richieste: riprova tra 15 minuti' }),
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: req => `${ipKeyGenerator(req.ip)}|verify`,
  handler: (req, res) => res.status(429).json({ error: 'Troppi tentativi: riprova tra 15 minuti' }),
});

const resendVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  keyGenerator: req => `${ipKeyGenerator(req.ip)}|resend`,
  handler: (req, res) => res.status(429).json({ error: 'Troppe richieste: riprova tra 15 minuti' }),
});

const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  keyGenerator: req => `${ipKeyGenerator(req.ip)}|${String(req.body?.username || '').toLowerCase().slice(0, 30)}`,
  handler: (req, res) => res.status(429).json({ error: 'Troppi tentativi: riprova tra 15 minuti' }),
});

const deleteAccountLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  handler: (req, res) => res.status(429).json({ error: 'Troppe richieste: riprova più tardi' }),
});

const slowDown = ms => new Promise(r => setTimeout(r, ms));

router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    await slowDown(300);
    const user = await authService.register(req.body || {});

    const finish = () => {
      req.session.userId = user.id;
      req.session.save(err => {
        if (err) return next(err);
        res.status(201).json(user);
      });
    };

    req.session.regenerate(err => {
      if (err) {
        console.warn('⚠️  Session regenerate (register):', err.message);
        return finish();
      }
      finish();
    });
  } catch (err) { next(err); }
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    await slowDown(300);
    const user = await authService.login(req.body || {});
    req.session.regenerate(err => {
      if (err) return next(err);
      req.session.userId = user.id;
      res.json(user);
    });
  } catch (err) { next(err); }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('wf.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(authService.publicUser(req.user));
});

router.post('/password', requireAuth, async (req, res, next) => {
  try {
    await slowDown(300);
    const user = await authService.changePassword(req.user.id, req.body || {});
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/email', requireAuth, async (req, res, next) => {
  try {
    await slowDown(200);
    const user = await authService.updateEmail(req.user.id, req.body || {});
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/forgot-password', forgotLimiter, async (req, res, next) => {
  try {
    await slowDown(400);
    const result = await authService.requestPasswordReset(req.body || {});
    res.json(result);
  } catch (err) { next(err); }
});

router.post('/reset-password', resetLimiter, async (req, res, next) => {
  try {
    await slowDown(300);
    const user = await authService.resetPassword(req.body || {});
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/verify-email', requireAuth, verifyLimiter, async (req, res, next) => {
  try {
    await slowDown(300);
    const user = await authService.verifyEmail(req.user.id, req.body || {});
    res.json(user);
  } catch (err) { next(err); }
});

router.post('/resend-verification', requireAuth, resendVerifyLimiter, async (req, res, next) => {
  try {
    await slowDown(400);
    const result = await authService.resendEmailVerification(req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

router.delete('/account', requireAuth, deleteAccountLimiter, async (req, res, next) => {
  try {
    await slowDown(400);
    await authService.deleteAccount(req.user.id, req.body || {});
    req.session.destroy(err => {
      if (err) return next(err);
      res.clearCookie('wf.sid');
      res.json({ ok: true });
    });
  } catch (err) { next(err); }
});

module.exports = router;
