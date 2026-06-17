/**
 * server/index.js — Entry point API + web app
 *
 * Solo bootstrap: middleware di sicurezza, sessioni, mounting delle route,
 * error handling. La logica vive in routes/ e services/.
 *
 * Sicurezza:
 *  - helmet con CSP esplicita (no inline script)
 *  - sessioni firmate su file, cookie httpOnly + sameSite
 *  - rate limit globale + limiti specifici nelle route
 *  - /photos serviti SOLO previa verifica di ownership (mai statici)
 *  - nessun CORS: l'app è servita dalla stessa origine
 */

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');
const photoCrypto = require('./services/photoCrypto');
const { FileSessionStore } = require('./services/sessionStore');
const { requireAuth, requireVerifiedEmail, getTripAccess } = require('./middleware/auth');
const { serveUserPhoto } = require('./services/photoServe');
const tripService = require('./services/tripService');

const APP_SHELL_PATH = path.join(__dirname, 'shells', 'app.html');

const app = express();

// Dietro cloudflared/reverse proxy: 1 hop fidato per IP reale e cookie secure
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ─── Cache-Control: mai cache di dati privati (API e foto) ─────────────────
// Doppia protezione col service worker, che già bypassa /api e /photos.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/photos/')) {
    res.set('Cache-Control', 'no-store');
  }
  next();
});

// ─── Helmet + CSP ──────────────────────────────────────────────────────────

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: [
        "'self'",
        'data:',
        'blob:',
        'https://a.tile.openstreetmap.org',
        'https://b.tile.openstreetmap.org',
        'https://c.tile.openstreetmap.org',
        'https://a.basemaps.cartocdn.com',
        'https://b.basemaps.cartocdn.com',
        'https://c.basemaps.cartocdn.com',
        'https://d.basemaps.cartocdn.com',
        'https://tiles.openfreemap.org',
      ],
      connectSrc: ["'self'", 'https://tiles.openfreemap.org'],
      workerSrc: ["'self'", 'blob:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // tile e font esterni
}));

// ─── Sessioni ──────────────────────────────────────────────────────────────

const sessionSecret = config.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
if (!config.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET mancante nel .env: generato al volo (le sessioni non sopravvivono al riavvio)');
}

const prodHost = /wayfold\.xyz/i.test(config.BASE_URL);
app.use(session({
  name: 'wf.sid',
  secret: sessionSecret,
  store: new FileSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',                    // true dietro https (tunnel), false su localhost
    maxAge: 14 * 24 * 60 * 60 * 1000,  // 14 giorni
    ...(prodHost ? { domain: '.wayfold.xyz' } : {}),
  },
}));

// ─── Body parsing + rate limit globale ─────────────────────────────────────

app.use(express.json({ limit: '16kb' }));

app.use('/api', rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  keyGenerator: req => (req.session?.userId ? `u${req.session.userId}` : ipKeyGenerator(req.ip)),
  handler: (req, res) => {
    console.warn(`🔒  Rate limit globale superato (${req.ip})`);
    res.status(429).json({ error: 'Troppe richieste: rallenta' });
  },
}));

// ─── Foto: servite SOLO al proprietario ────────────────────────────────────

const SAFE_FILE = /^[\w.-]{1,120}$/;

app.get('/photos/:tripId/:file', requireAuth, requireVerifiedEmail, async (req, res, next) => {
  const { tripId, file } = req.params;

  if (!/^\d{1,10}$/.test(tripId) || !SAFE_FILE.test(file) || file.includes('..')) {
    return res.status(404).json({ error: 'Non trovato' });
  }

  const trip = db.getTripById(tripId);
  if (!trip || !getTripAccess(req.user, trip)) {
    return res.status(404).json({ error: 'Non trovato' });
  }

  try {
    const served = await serveUserPhoto(res, { tripId, file });
    if (!served) return res.status(404).json({ error: 'Non trovato' });
  } catch (err) {
    next(err);
  }
});

// ─── Pagine HTML (login pubblica, app solo con sessione) ───────────────────

function getSessionUser(req) {
  const userId = req.session?.userId;
  if (!userId) return null;
  return db.getUserById(userId) || null;
}

function isVerifiedUser(user) {
  return user && user.emailVerified !== false;
}

app.get('/', (req, res) => {
  res.redirect(isVerifiedUser(getSessionUser(req)) ? '/app' : '/login');
});

app.get('/login', (req, res) => {
  if (isVerifiedUser(getSessionUser(req))) {
    return res.redirect('/app');
  }
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(config.PUBLIC_DIR, 'login.html'));
});

app.get('/app', (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    const next = encodeURIComponent(req.originalUrl);
    return res.redirect(`/login?next=${next}`);
  }
  if (!user.emailVerified) {
    return res.redirect('/login');
  }
  res.set('Cache-Control', 'no-store');
  res.sendFile(APP_SHELL_PATH);
});

app.get('/app.html', (req, res) => res.status(404).end());

// ─── Web app statica ───────────────────────────────────────────────────────

app.use(express.static(config.PUBLIC_DIR, {
  setHeaders: (res, filePath) => {
    const base = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    if (base === 'sw.js' || base === 'manifest.webmanifest') {
      res.set('Cache-Control', 'no-cache');
    } else if (ext === '.js' || ext === '.css' || base === 'login.html') {
      // JS/CSS/HTML: rivalidazione frequente (evita banner PWA bloccati in dev)
      res.set('Cache-Control', 'no-cache');
    } else {
      res.set('Cache-Control', 'public, max-age=86400');
    }
  },
}));

// ─── API ───────────────────────────────────────────────────────────────────

app.use('/api/auth', require('./routes/auth'));
app.use('/api/status', require('./routes/status'));
app.use('/api/trips', require('./routes/trips'));
app.use('/api/photos', require('./routes/photos'));
app.use('/api/shares', require('./routes/shares'));
app.use('/api/share-codes', require('./routes/shareCodes'));

// 404 esplicito per route API sconosciute (non deve cadere nel fallback HTML)
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint non trovato' }));

// 404 per navigazioni HTML sconosciute
app.get('*', (req, res) => {
  if (req.accepts('html')) {
    return res.redirect('/');
  }
  res.status(404).end();
});

// ─── Error handler centralizzato (mai stack trace verso il client) ─────────

app.use((err, req, res, next) => {
  // Errori multer (file troppo grande, troppi file…) → messaggi puliti
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File troppo grande (max 25 MB)' });
  }
  if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(413).json({ error: 'Troppi file in una sola richiesta (max 12)' });
  }
  const status = err.status || 500;
  if (status >= 500) console.error('❌ ', err.message);
  res.status(status).json({ error: err.status ? err.message : 'Errore interno' });
});

// ─── Avvio ─────────────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production'
  || !/localhost|127\.0\.0\.1/i.test(config.BASE_URL);

if (isProduction && !photoCrypto.escrowAvailable()) {
  console.error('❌  PHOTO_BOT_ESCROW_KEY mancante o non valida: obbligatoria in produzione.');
  console.error('    Genera con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"');
  process.exit(1);
}

const server = app.listen(config.PORT, () => {
  console.log(`🌍  Server → ${config.BASE_URL}`);
  console.log(`📡  API: /api/auth /api/status /api/trips /api/photos /api/shares`);
  if (photoCrypto.escrowAvailable()) {
    console.log('🔐  Cifratura foto: attiva (AES-256-GCM + escrow)');
  }
  if (!config.PHOTOS_KEEP_LOCAL) {
    console.log('💾  Foto: solo Telegram (nessuna copia locale su disco)');
  }
  tripService.ensureGeocodingBackfill();
});
// Anti-Slowloris
server.headersTimeout = 30 * 1000;
server.requestTimeout = 5 * 60 * 1000; // upload grandi su reti lente
