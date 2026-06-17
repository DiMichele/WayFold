/**
 * middleware/uploadGuard.js — Validazione rigorosa degli upload
 *
 * Il mimetype dichiarato dal client NON è affidabile: ogni file viene
 * verificato leggendo la firma binaria reale (magic bytes).
 * Formati ammessi: JPEG, PNG, WebP, HEIC/HEIF. SVG e GIF esclusi.
 *
 * In più: quota disco/numero foto per utente e cleanup garantito dei
 * file temporanei su qualsiasi esito.
 */

const fs = require('fs');
const db = require('../db');
const config = require('../config');
const photoCrypto = require('../services/photoCrypto');

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'hevx', 'heif', 'mif1', 'msf1'];
const ENC_MAGIC = Buffer.from('WFENC1', 'ascii');

/** Verifica che il file inizi col magic WFENC1 (foto cifrata dal client). */
function isEncryptedFile(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(ENC_MAGIC.length);
    const read = fs.readSync(fd, buf, 0, ENC_MAGIC.length, 0);
    return read === ENC_MAGIC.length && buf.equals(ENC_MAGIC);
  } catch {
    return false;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/**
 * Rileva il vero formato immagine dai magic bytes.
 * @returns {{ ext: string, mime: string } | null}
 */
function sniffImageType(filePath) {
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    if (read < 12) return null;

    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
      return { ext: 'jpg', mime: 'image/jpeg' };
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
      return { ext: 'png', mime: 'image/png' };
    }
    // WebP: "RIFF" .... "WEBP"
    if (buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
        buf.subarray(8, 12).toString('ascii') === 'WEBP') {
      return { ext: 'webp', mime: 'image/webp' };
    }
    // HEIC/HEIF: "ftyp" a offset 4 con brand noto
    if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
      const brand = buf.subarray(8, 12).toString('ascii').toLowerCase();
      if (HEIC_BRANDS.includes(brand)) {
        return { ext: 'heic', mime: 'image/heic' };
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Elimina in sicurezza tutti i file temporanei di una richiesta multer. */
function cleanupTempFiles(files) {
  for (const f of files || []) {
    if (f?.path) fs.rmSync(f.path, { force: true });
  }
}

/**
 * Valida i file caricati: firma binaria + quota utente.
 * Arricchisce ogni file valido con { detectedExt, detectedMime, size }.
 * @throws {Error} con status appropriato; i temp file vengono puliti dal chiamante
 */
/** True: tutti gli upload web devono essere cifrati E2E nel browser. */
function encryptionRequired() {
  return true;
}

function validateUpload(user, files, { encrypted = false, requireEncrypted = false } = {}) {
  if (!files?.length) {
    throw Object.assign(new Error('Nessuna immagine ricevuta'), { status: 400 });
  }

  if (requireEncrypted && !encrypted) {
    console.warn(`🔒  Upload in chiaro respinto (E2E obbligatorio): utente ${user.id}`);
    throw Object.assign(
      new Error('Le foto devono essere cifrate nel browser prima dell\'upload'),
      { status: 415 }
    );
  }

  // Quota: stato attuale + dimensione della richiesta
  const usage = db.getUserUsage(user.id);
  const quotaBytes = config.UPLOAD_QUOTA_MB * 1024 * 1024;
  const incomingBytes = files.reduce((n, f) => n + (f.size || 0), 0);

  if (usage.count + files.length > config.UPLOAD_MAX_PHOTOS) {
    throw Object.assign(
      new Error(`Limite foto raggiunto (${config.UPLOAD_MAX_PHOTOS} per account)`),
      { status: 413 }
    );
  }
  if (usage.bytes + incomingBytes > quotaBytes) {
    const leftMb = Math.max(0, (quotaBytes - usage.bytes) / 1024 / 1024).toFixed(0);
    throw Object.assign(
      new Error(`Quota disco superata: ${leftMb} MB rimanenti su ${config.UPLOAD_QUOTA_MB} MB`),
      { status: 413 }
    );
  }

  // Firma binaria di ogni file
  for (const file of files) {
    if (!file.size) {
      throw Object.assign(new Error('File vuoto'), { status: 415 });
    }

    // Foto cifrate dal client: validiamo solo il magic WFENC1, non il contenuto
    // (è un blob opaco). Il vero tipo immagine viaggia nei metadati del client.
    if (encrypted) {
      if (!isEncryptedFile(file.path)) {
        console.warn(`🔒  Upload cifrato respinto (magic mancante): da utente ${user.id}`);
        throw Object.assign(new Error('File cifrato non valido'), { status: 415 });
      }
      file.encrypted = true;
      file.detectedExt = 'wfenc';
      file.detectedMime = 'application/octet-stream';
      continue;
    }

    const type = sniffImageType(file.path);
    if (!type) {
      console.warn(`🔒  Upload respinto (non è un'immagine valida): "${file.originalname}" da utente ${user.id}`);
      throw Object.assign(
        new Error('Formato non supportato: sono ammessi solo JPEG, PNG, WebP e HEIC'),
        { status: 415 }
      );
    }
    file.detectedExt = type.ext;
    file.detectedMime = type.mime;
  }
  return files;
}

module.exports = { sniffImageType, validateUpload, cleanupTempFiles, encryptionRequired };
