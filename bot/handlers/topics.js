/**
 * handlers/topics.js — Topic Telegram → viaggi
 *
 * Ogni topic del gruppo Forum è un viaggio:
 *  - forum_topic_created → crea il viaggio (con geocoding)
 *  - forum_topic_edited  → rinomina il viaggio
 */

const config = require('../../server/config');
const tripService = require('../../server/services/tripService');

function register(bot) {
  bot.on('message', async (msg) => {
    // Finché GROUP_ID non è configurato, logga l'ID di ogni chat
    if (!config.GROUP_ID) {
      console.log(`ℹ️   Chat ID: ${msg.chat.id} ("${msg.chat.title || msg.chat.username || '?'}") → aggiungilo al .env come GROUP_ID`);
    } else if (String(msg.chat.id) !== String(config.GROUP_ID)) {
      return;
    }

    try {
      if (msg.forum_topic_created && msg.message_thread_id) {
        const trip = await tripService.createFromTopic({
          topicId: msg.message_thread_id,
          name: msg.forum_topic_created.name,
        });
        console.log(`✨  Nuovo viaggio registrato: "${trip.name}" (topic ${msg.message_thread_id})`);
      }

      if (msg.forum_topic_edited?.name && msg.message_thread_id) {
        const trip = await tripService.renameFromTopic(msg.message_thread_id, msg.forum_topic_edited.name);
        if (trip) console.log(`✏️   Viaggio rinominato: "${trip.name}"`);
      }
    } catch (err) {
      console.error('❌  Errore gestione topic:', err.message);
    }
  });
}

module.exports = { register };
