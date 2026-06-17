/**
 * handlers/media.js — Foto e documenti immagine → archivio
 *
 * In produzione le foto vengono salvate in photos/{tripId}/.
 * In locale (PHOTOS_KEEP_LOCAL=false) restano solo su Telegram; EXIF da file temporaneo.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../server/config');
const db = require('../../server/db');
const tripService = require('../../server/services/tripService');
const telegram = require('../../server/services/telegram');
const photoCrypto = require('../../server/services/photoCrypto');
const { extractPhotoMeta } = require('../../server/services/exif');
const { downloadFile } = require('../utils/download');

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic'];
const DELETE_PLAIN_ATTEMPTS = 5;

/** Elimina il messaggio Telegram originale in chiaro, con retry backoff. */
async function deletePlainOriginal(msgId) {
  for (let attempt = 0; attempt < DELETE_PLAIN_ATTEMPTS; attempt++) {
    try {
      await telegram.deleteMessage(msgId);
      return true;
    } catch (err) {
      const last = attempt === DELETE_PLAIN_ATTEMPTS - 1;
      if (last) {
        console.error(
          `❌  Originale in chiaro NON eliminato dopo ${DELETE_PLAIN_ATTEMPTS} tentativi (msg ${msgId}):`,
          err.message
        );
        return false;
      }
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return false;
}

function register(bot) {
  bot.on('photo', (msg) => handleMedia(bot, msg, 'photo'));
  bot.on('document', (msg) => {
    if (!msg.document?.mime_type?.startsWith('image/')) return;
    handleMedia(bot, msg, 'document');
  });
}

async function handleMedia(bot, msg, type) {
  if (config.GROUP_ID && String(msg.chat.id) !== String(config.GROUP_ID)) return;

  const topicId = msg.message_thread_id;
  if (!topicId) {
    console.log('⚠️  Foto fuori da un topic — ignorata');
    return;
  }

  try {
    let trip = db.getTripByTopicId(topicId);
    if (!trip) {
      const name = await resolveTopicName(bot, msg, topicId);
      trip = await tripService.createFromTopic({ topicId, name });
      console.log(`⚠️  Topic ${topicId} non registrato — creato come "${trip.name}"`);
    }

    const existing = db.getPhotoByMsgId(trip.id, msg.message_id);
    if (existing) return;

    const srcFileId = type === 'photo'
      ? msg.photo[msg.photo.length - 1].file_id
      : msg.document.file_id;
    const originalMime = type === 'photo'
      ? 'image/jpeg'
      : (msg.document?.mime_type || 'image/jpeg');
    const originalExt = type === 'photo' ? 'jpg' : getExtension(msg.document?.file_name);

    const fileUrl = await bot.getFileLink(srcFileId);

    // Scarica in chiaro su file temporaneo per la cifratura. Su Telegram il file
    // in chiaro verrà sostituito subito dopo con il blob WFENC1.
    const tmpPath = path.join(os.tmpdir(), `wf_${Date.now()}_${msg.message_id}.${originalExt}`);
    let plainSize = 0;
    try {
      await downloadFile(fileUrl, tmpPath);
      plainSize = fs.statSync(tmpPath).size;
      if (plainSize === 0) throw new Error('File scaricato vuoto');
    } catch (err) {
      fs.unlink(tmpPath, () => {});
      throw err;
    }

    const tripKey = await tripService.getTripKey(trip);

    // ── Ri-cifratura: rimpiazza il messaggio in chiaro con uno cifrato ──────
    if (tripKey) {
      const encPath = `${tmpPath}.wfenc`;
      try {
        fs.writeFileSync(encPath, photoCrypto.encryptBuffer(fs.readFileSync(tmpPath), tripKey));

        const tgMsg = await telegram.sendDocument(trip.topicId, encPath, {
          fileName: `photo_${Date.now()}.wfenc`,
          mime: 'application/octet-stream',
          caption: msg.caption || '',
        });
        const newMsgId = tgMsg.message_id;
        const fileName = `${Date.now()}_${newMsgId}.wfenc`;
        const encSize = fs.statSync(encPath).size;

        await deletePlainOriginal(msg.message_id);

        await db.addPhoto({
          tripId: trip.id,
          fileName,
          fileId: tgMsg.document?.file_id ?? null,
          caption: msg.caption || '',
          msgId: newMsgId,
          date: msg.date,
          takenAt: null,
          lat: null,
          lon: null,
          size: encSize,
          uploadedByUserId: trip.userId,
          encrypted: true,
          originalMime,
          originalExt,
        });

        if (config.PHOTOS_KEEP_LOCAL) {
          const tripDir = path.join(config.PHOTOS_DIR, String(trip.id));
          fs.mkdirSync(tripDir, { recursive: true });
          fs.renameSync(encPath, path.join(tripDir, fileName));
        } else {
          fs.unlinkSync(encPath);
        }

        console.log(`🔐  [${trip.name}] ${fileName} cifrata (msg ${msg.message_id} → ${newMsgId})`);
      } finally {
        fs.unlink(tmpPath, () => {});
        fs.unlink(encPath, () => {});
      }
      return;
    }

    // ── Nessuna cifratura configurata: comportamento legacy (in chiaro) ─────
    let meta = {};
    try {
      meta = await extractPhotoMeta(tmpPath);
    } catch { /* best effort */ }
    const photoDate = meta.date ?? msg.date;
    const dateSource = meta.date ? 'EXIF' : 'Telegram';
    const takenAt = meta.takenAt || (meta.date ? new Date(meta.date * 1000).toISOString() : null);

    const fileName = `${Date.now()}_${msg.message_id}.${originalExt}`;
    try {
      if (config.PHOTOS_KEEP_LOCAL) {
        const tripDir = path.join(config.PHOTOS_DIR, String(trip.id));
        fs.mkdirSync(tripDir, { recursive: true });
        fs.renameSync(tmpPath, path.join(tripDir, fileName));
      }
    } finally {
      fs.unlink(tmpPath, () => {});
    }

    await db.addPhoto({
      tripId: trip.id,
      fileName,
      fileId: srcFileId,
      caption: msg.caption || '',
      msgId: msg.message_id,
      date: photoDate,
      takenAt,
      lat: meta.lat,
      lon: meta.lon,
      size: plainSize,
      uploadedByUserId: trip.userId,
    });

    const when = takenAt
      ? new Date(takenAt).toLocaleDateString('it-IT')
      : new Date(photoDate * 1000).toLocaleDateString('it-IT');
    const storage = config.PHOTOS_KEEP_LOCAL ? 'disco' : 'Telegram';
    console.log(`📸  [${trip.name}] ${fileName} (${when}, ${dateSource}, ${storage})${msg.caption ? ' — ' + msg.caption : ''}`);
  } catch (err) {
    console.error(`❌  Errore gestione foto (msg ${msg.message_id}):`, err.message);
  }
}

async function resolveTopicName(bot, msg, topicId) {
  const created = msg.reply_to_message?.forum_topic_created?.name;
  if (created) return created;
  return `Viaggio #${topicId}`;
}

function getExtension(fileName) {
  if (!fileName) return 'jpg';
  const ext = path.extname(fileName).replace('.', '').toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) ? ext : 'jpg';
}

module.exports = { register };
