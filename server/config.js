/**
 * config.js — Configurazione centralizzata
 *
 * Unico punto di accesso alle variabili d'ambiente.
 * Il path del .env è assoluto (relativo a questo file, non alla cwd),
 * così `npm start` funziona da qualsiasi directory.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

require('dotenv').config({ path: path.join(ROOT, '.env') });

const PORT = Number(process.env.PORT) || 3000;

function resolvePhotosKeepLocal() {
  const env = (process.env.PHOTOS_KEEP_LOCAL || '').trim().toLowerCase();
  if (env === 'true') return true;
  if (env === 'false') return false;
  const base = (process.env.BASE_URL || `http://localhost:${PORT}`).toLowerCase();
  if (/localhost|127\.0\.0\.1/.test(base)) return false;
  return process.env.NODE_ENV === 'production';
}

module.exports = {
  ROOT,
  PORT,
  BASE_URL: process.env.BASE_URL || `http://localhost:${PORT}`,
  BOT_TOKEN: (process.env.BOT_TOKEN || '').trim(),
  GROUP_ID: (process.env.GROUP_ID || '').trim(),
  DB_PATH: path.join(ROOT, 'db.json'),
  PHOTOS_DIR: path.join(ROOT, 'photos'),
  /** In locale (localhost) le immagini restano solo su Telegram; in produzione si salvano anche su disco. */
  PHOTOS_KEEP_LOCAL: resolvePhotosKeepLocal(),
  PUBLIC_DIR: path.join(ROOT, 'public'),
  SESSIONS_DIR: path.join(ROOT, 'sessions'),

  // Sicurezza / multi-utente
  SESSION_SECRET: (process.env.SESSION_SECRET || '').trim(),
  UPLOAD_QUOTA_MB: Number(process.env.UPLOAD_QUOTA_MB) || 500,
  UPLOAD_MAX_PHOTOS: Number(process.env.UPLOAD_MAX_PHOTOS) || 1000,

  // Email (recupero password)
  SMTP_HOST: (process.env.SMTP_HOST || '').trim(),
  SMTP_PORT: Number(process.env.SMTP_PORT) || 587,
  SMTP_SECURE: process.env.SMTP_SECURE === 'true',
  SMTP_USER: (process.env.SMTP_USER || '').trim(),
  SMTP_PASS: process.env.SMTP_PASS || '',
  SMTP_FROM: (process.env.SMTP_FROM || '').trim(),
  MAIL_LOG_CODES: process.env.MAIL_LOG_CODES === 'true',

  // ID Telegram (separati da virgola) autorizzati ai comandi admin del bot
  BOT_ADMIN_IDS: (process.env.BOT_ADMIN_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),

  // Mappa (Mapbox GL — token pubblico con restrizioni URL su mapbox.com)
  MAPBOX_TOKEN: (process.env.MAPBOX_TOKEN || '').trim(),
};
