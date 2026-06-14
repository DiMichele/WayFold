/**

 * handlers/commands.js — Comandi del bot

 *

 *   /status           riepilogo viaggi e foto

 *   /users            elenco utenti

 *   /finduser         cerca account per username/email

 *   /resetpassword    reimposta password e invia quella temporanea via email

 *   /deleteaccount    elimina account

 *   /help             istruzioni d'uso

 */



const config = require('../../server/config');

const db = require('../../server/db');

const authService = require('../../server/services/authService');

const { canRunAdminCommands } = require('../utils/admin');

const { formatUserList, chunkMessages } = require('../utils/users');

const { buildUserKeyboard, usersForPicker } = require('../utils/userPicker');
const { escMd } = require('../utils/escape');



function register(bot) {

  bot.onText(/^\/status\b/, async (msg) => {
    if (!allowed(msg)) return;

    const userCount = db.countUsers();
    const trips = db.getAllTrips();
    const photoCount = trips.reduce((n, t) => n + db.getPhotos(t.id).length, 0);

    await reply(
      bot,
      msg,
      [
        `Utenti registrati: ${userCount}`,
        `Topic creati: ${trips.length}`,
        `Foto caricate: ${photoCount}`,
      ].join('\n')
    );
  });



  bot.onText(/^\/users(?:@\w+)?$/i, async (msg) => {

    if (!allowed(msg)) return;

    if (!(await requireAdmin(bot, msg))) return;



    const users = db.getAllUsers();

    if (!users.length) {

      return reply(bot, msg, 'Nessun utente registrato.');

    }



    const text = formatUserList(users);

    for (const chunk of chunkMessages(text)) {

      await reply(bot, msg, chunk, { parse_mode: 'Markdown' });

    }

  });



  bot.onText(/^\/finduser(?:@\w+)?$/i, async (msg) => {

    if (!allowed(msg)) return;

    if (!(await requireAdmin(bot, msg))) return;

    await showUserPicker(bot, msg, 'find', 'Seleziona un utente o usa /finduser <testo>');

  });



  bot.onText(/^\/finduser(?:@\w+)?\s+(.+)/i, async (msg, match) => {

    if (!allowed(msg)) return;

    if (!(await requireAdmin(bot, msg))) return;



    const query = match[1].trim();

    if (query.length < 2) {

      return reply(bot, msg, 'Inserisci almeno 2 caratteri per la ricerca.');

    }



    const users = db.searchUsers(query);

    if (!users.length) {

      return reply(bot, msg, `Nessun account trovato per "${query}".`);

    }



    const text = formatUserList(users);

    for (const chunk of chunkMessages(text)) {

      await reply(bot, msg, chunk, { parse_mode: 'Markdown' });

    }

  });



  bot.onText(/^\/resetpassword(?:@\w+)?$/i, async (msg) => {

    if (!allowed(msg)) return;

    await showUserPicker(bot, msg, 'reset', 'Seleziona l\'utente per il reset password:');

  });



  bot.onText(/^\/resetpassword(?:@\w+)?\s+(\S+)/i, async (msg, match) => {

    if (!allowed(msg)) return;

    const username = match[1];

    try {

      const result = await authService.resetPasswordByAdmin({ username });

      await reply(bot, msg, result.message);

    } catch (err) {

      await reply(bot, msg, err.message || 'Operazione non riuscita');

    }

  });



  bot.onText(/^\/deleteaccount(?:@\w+)?$/i, async (msg) => {

    if (!allowed(msg)) return;

    if (!(await requireAdmin(bot, msg))) return;

    await showUserPicker(bot, msg, 'delete', 'Seleziona l\'account da eliminare:');

  });



  bot.onText(/^\/deleteaccount(?:@\w+)?\s+(\S+)/i, async (msg, match) => {

    if (!allowed(msg)) return;

    if (!(await requireAdmin(bot, msg))) return;



    const username = match[1];

    try {

      const result = await authService.deleteAccountByUsername(username);

      await reply(

        bot,

        msg,

        `Account *${escMd(result.username)}* eliminato: ${result.trips} viaggi, ${result.photos} foto.`,

        { parse_mode: 'Markdown' }

      );

    } catch (err) {

      const text = err.status === 404

        ? 'Utente non trovato.'

        : (err.message || 'Operazione non riuscita');

      await reply(bot, msg, text);

    }

  });



  bot.onText(/^\/help\b/, async (msg) => {
    if (!allowed(msg)) return;
    await reply(
      bot,
      msg,
      [
        '*Comandi*',
        '/status — statistiche generali',
        '/users — elenco utenti registrati',
        '/finduser — ricerca per username o email',
        '/resetpassword — reimposta password e invia quella temporanea via email',
        '/deleteaccount — eliminazione account',
      ].join('\n'),
      { parse_mode: 'Markdown' }
    );
  });

}



function allowed(msg) {

  return !config.GROUP_ID || String(msg.chat.id) === String(config.GROUP_ID);

}



async function requireAdmin(bot, msg) {

  if (await canRunAdminCommands(bot, msg)) return true;

  await reply(bot, msg, 'Operazione non autorizzata.');

  return false;

}



function reply(bot, msg, text, opts = {}) {

  const extra = { ...opts };

  if (msg.message_thread_id) extra.message_thread_id = msg.message_thread_id;

  return bot.sendMessage(msg.chat.id, text, extra);

}



async function showUserPicker(bot, msg, action, title) {
  const users = usersForPicker('');
  if (!users.length) {
    return reply(bot, msg, 'Nessun utente registrato.');
  }
  await reply(bot, msg, title, {
    reply_markup: buildUserKeyboard(users, action, 0),
  });
}



module.exports = { register };

