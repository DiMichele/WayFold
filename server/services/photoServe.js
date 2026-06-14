/**
 * photoServe.js — Serve le foto al browser (disco locale o proxy Telegram)
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const db = require('../db');
const telegram = require('./telegram');

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic',
};

function photoHeaders(ext) {
  return {
    'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
    // Contenuto privato: mai in cache (HTTP o service worker)
    'Cache-Control': 'no-store',
  };
}

/**
 * @returns {Promise<boolean>} true se la risposta è stata inviata
 */
async function serveUserPhoto(res, { tripId, file }) {
  const decoded = decodeURIComponent(file);
  const photo = db.getPhotoByFile(tripId, decoded);
  if (!photo) return false;

  const ext = path.extname(decoded).toLowerCase();
  const abs = path.resolve(config.PHOTOS_DIR, String(tripId), decoded);
  const inPhotosDir = abs.startsWith(path.resolve(config.PHOTOS_DIR) + path.sep);

  if (inPhotosDir && fs.existsSync(abs)) {
    res.set(photoHeaders(ext));
    res.sendFile(abs);
    return true;
  }

  if (photo.fileId && telegram.enabled()) {
    res.set(photoHeaders(ext));
    await telegram.pipeFile(photo.fileId, res);
    return true;
  }

  return false;
}

module.exports = { serveUserPhoto };
