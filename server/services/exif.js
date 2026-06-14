/**
 * exif.js — Estrazione metadati dalle immagini scaricate
 *
 * Priorità data: DateTimeOriginal → CreateDate → ModifyDate.
 * Le foto compresse da Telegram spesso perdono l'EXIF; in quel caso
 * il chiamante usa la data del messaggio come fallback.
 */

const exifr = require('exifr');

/**
 * @param {string} filePath  percorso assoluto del file immagine
 * @returns {{ date?: number, takenAt?: string, lat?: number, lon?: number }}
 */
async function extractPhotoMeta(filePath) {
  try {
    const data = await exifr.parse(filePath, {
      pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'latitude', 'longitude'],
    });
    if (!data) return {};

    const raw = data.DateTimeOriginal || data.CreateDate || data.ModifyDate;
    const out = {};

    if (raw) {
      const d = raw instanceof Date ? raw : new Date(raw);
      if (!Number.isNaN(d.getTime())) {
        out.takenAt = d.toISOString();
        out.date = Math.floor(d.getTime() / 1000);
      }
    }

    if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
      out.lat = data.latitude;
      out.lon = data.longitude;
    }

    return out;
  } catch {
    return {};
  }
}

module.exports = { extractPhotoMeta };
