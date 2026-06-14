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
const { extractPhotoMeta } = require('../../server/services/exif');
const { downloadFile } = require('../utils/download');

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic'];

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

    const fileId = type === 'photo'
      ? msg.photo[msg.photo.length - 1].file_id
      : msg.document.file_id;

    const fileUrl = await bot.getFileLink(fileId);
    const ext = type === 'photo' ? 'jpg' : getExtension(msg.document?.file_name);
    const fileName = `${Date.now()}_${msg.message_id}.${ext}`;

    let meta = {};
    let fileSize = type === 'photo'
      ? (msg.photo[msg.photo.length - 1].file_size ?? null)
      : (msg.document?.file_size ?? null);

    if (config.PHOTOS_KEEP_LOCAL) {
      const tripDir = path.join(config.PHOTOS_DIR, String(trip.id));
      fs.mkdirSync(tripDir, { recursive: true });
      const filePath = path.join(tripDir, fileName);
      await downloadFile(fileUrl, filePath);
      fileSize = fs.statSync(filePath).size;
      if (fileSize === 0) {
        fs.unlinkSync(filePath);
        throw new Error('File scaricato vuoto');
      }
      meta = await extractPhotoMeta(filePath);
    } else {
      const tmpPath = path.join(os.tmpdir(), `wf_${fileName}`);
      try {
        await downloadFile(fileUrl, tmpPath);
        fileSize = fs.statSync(tmpPath).size;
        if (fileSize === 0) throw new Error('File scaricato vuoto');
        meta = await extractPhotoMeta(tmpPath);
      } finally {
        fs.unlink(tmpPath, () => {});
      }
    }

    const photoDate = meta.date ?? msg.date;
    const dateSource = meta.date ? 'EXIF' : 'Telegram';

    await db.addPhoto({
      tripId: trip.id,
      fileName,
      fileId,
      caption: msg.caption || '',
      msgId: msg.message_id,
      date: photoDate,
      takenAt: meta.takenAt || (meta.date ? new Date(meta.date * 1000).toISOString() : null),
      lat: meta.lat,
      lon: meta.lon,
      size: fileSize,
      uploadedByUserId: trip.userId,
    });

    const when = meta.takenAt
      ? new Date(meta.takenAt).toLocaleDateString('it-IT')
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
