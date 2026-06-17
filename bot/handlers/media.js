/**
 * handlers/media.js — Foto Telegram (E2E)
 *
 * Il bot NON cifra e NON può accedere alle chiavi album.
 * - Foto/documenti immagine in chiaro → eliminati con istruzioni all'app web.
 * - Documenti .wfenc (WFENC1) → accettati come blob opachi già cifrati.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../../server/config');
const db = require('../../server/db');
const tripService = require('../../server/services/tripService');
const telegram = require('../../server/services/telegram');
const photoCrypto = require('../../server/services/photoCrypto');
const { downloadFile } = require('../utils/download');

const ENC_MAGIC = Buffer.from('WFENC1', 'ascii');
const E2E_HINT = '🔐 Le foto vanno caricate dall\'app web Wayfold (cifrate E2E). '
  + 'Invio diretto su Telegram non supportato per proteggere la privacy.';

function register(bot) {
  bot.on('photo', (msg) => handlePlainReject(bot, msg));
  bot.on('document', (msg) => {
    const mime = msg.document?.mime_type || '';
    const name = (msg.document?.file_name || '').toLowerCase();
    if (name.endsWith('.wfenc') || mime === 'application/octet-stream') {
      handleEncryptedDocument(bot, msg);
      return;
    }
    if (mime.startsWith('image/')) handlePlainReject(bot, msg);
  });
}

async function handlePlainReject(bot, msg) {
  if (config.GROUP_ID && String(msg.chat.id) !== String(config.GROUP_ID)) return;
  if (!msg.message_thread_id) return;
  try {
    await telegram.deleteMessage(msg.message_id);
    await bot.sendMessage(msg.chat.id, E2E_HINT, {
      message_thread_id: msg.message_thread_id,
    });
    console.log(`🔒  Foto in chiaro respinta (msg ${msg.message_id}) — E2E obbligatorio`);
  } catch (err) {
    console.error(`❌  Impossibile respingere foto in chiaro (msg ${msg.message_id}):`, err.message);
  }
}

async function handleEncryptedDocument(bot, msg) {
  if (config.GROUP_ID && String(msg.chat.id) !== String(config.GROUP_ID)) return;
  const topicId = msg.message_thread_id;
  if (!topicId) return;

  try {
    let trip = db.getTripByTopicId(topicId);
    if (!trip) {
      const name = msg.reply_to_message?.forum_topic_created?.name || `Viaggio #${topicId}`;
      trip = await tripService.createFromTopic({ topicId, name });
    }

    if (db.getPhotoByMsgId(trip.id, msg.message_id)) return;

    const fileId = msg.document.file_id;
    const tmpPath = path.join(os.tmpdir(), `wf_${Date.now()}_${msg.message_id}.wfenc`);
    try {
      const fileUrl = await bot.getFileLink(fileId);
      await downloadFile(fileUrl, tmpPath);
      const head = Buffer.alloc(ENC_MAGIC.length);
      const fd = fs.openSync(tmpPath, 'r');
      fs.readSync(fd, head, 0, ENC_MAGIC.length, 0);
      fs.closeSync(fd);
      if (!head.equals(ENC_MAGIC)) {
        fs.unlink(tmpPath, () => {});
        await handlePlainReject(bot, msg);
        return;
      }
    } catch (err) {
      fs.unlink(tmpPath, () => {});
      throw err;
    }

    const encSize = fs.statSync(tmpPath).size;
    const fileName = `${Date.now()}_${msg.message_id}.wfenc`;
    const originalExt = 'jpg';
    const originalMime = 'image/jpeg';

    if (config.PHOTOS_KEEP_LOCAL) {
      const tripDir = path.join(config.PHOTOS_DIR, String(trip.id));
      fs.mkdirSync(tripDir, { recursive: true });
      fs.renameSync(tmpPath, path.join(tripDir, fileName));
    } else {
      fs.unlinkSync(tmpPath);
    }

    await db.addPhoto({
      tripId: trip.id,
      fileName,
      fileId,
      caption: msg.caption || '',
      msgId: msg.message_id,
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

    console.log(`🔐  [${trip.name}] ${fileName} (WFENC1 via Telegram)`);
  } catch (err) {
    console.error(`❌  Errore gestione .wfenc (msg ${msg.message_id}):`, err.message);
  }
}

module.exports = { register };
