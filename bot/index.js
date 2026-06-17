/**
 * bot/index.js — Entry point del bot Telegram
 *
 * Solo bootstrap: crea il bot in polling mode e registra gli handler.
 * La logica vive in handlers/ e nei servizi condivisi del server.
 *
 * Setup:
 *   1. Crea un bot su @BotFather → BOT_TOKEN nel .env
 *   2. Crea un gruppo Telegram → attiva i "Topics" (Argomenti)
 *   3. Aggiungi il bot al gruppo come admin
 *   4. Il bot logga il GROUP_ID al primo messaggio → copialo nel .env
 */

const { TelegramClient } = require('./telegramClient');
const config = require('../server/config');

if (!config.BOT_TOKEN) {
  console.log('');
  console.log('⚠️   BOT_TOKEN mancante nel .env — il bot non parte.');
  console.log('    1. Apri @BotFather su Telegram → /newbot → copia il token');
  console.log('    2. Incollalo nel file .env come BOT_TOKEN=...');
  console.log('    Il server web funziona comunque.');
  console.log('');
  process.exit(0);
}

const bot = new TelegramClient(config.BOT_TOKEN);

require('./handlers/topics').register(bot);
require('./handlers/media').register(bot);
require('./handlers/commands').register(bot);
require('./handlers/callbacks').register(bot);
require('./handlers/inline').register(bot);
const { setupBotCommands } = require('./setup/commandsMenu');

// Log errori di polling senza floodare (es. rete assente, token revocato)
let lastPollingError = '';
bot.on('polling_error', (err) => {
  const text = `${err.code || ''} ${err.message || err}`.trim();
  if (text !== lastPollingError) {
    console.error('⚠️  Polling error:', text);
    lastPollingError = text;
  }
});

bot.getMe()
  .then(async me => {
    bot.username = me.username;
    console.log(`🤖  Bot avviato: @${me.username} — in ascolto...`);
    try {
      await setupBotCommands(bot);
      console.log('📋  Menu comandi Telegram registrato');
    } catch (err) {
      console.warn('⚠️  Menu comandi non registrato:', err.message);
    }
    if (!config.GROUP_ID) {
      console.log('ℹ️   GROUP_ID non impostato — scriverò il Chat ID ad ogni messaggio ricevuto');
    }
    bot.startPolling();
  })
  .catch(err => {
    console.error('❌  Token non valido o Telegram non raggiungibile:', err.message);
    process.exit(1);
  });
