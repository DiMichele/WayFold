/**
 * handlers/callbacks.js — Click sui pulsanti di scelta utente
 */

const authService = require('../../server/services/authService');
const db = require('../../server/db');
const { canRunAdminCommands } = require('../utils/admin');
const { buildUserKeyboard, usersForPicker } = require('../utils/userPicker');

function register(bot) {
  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    const msg = query.message;
    if (!msg) {
      return bot.answerCallbackQuery(query.id, { text: 'Messaggio non valido' });
    }

    const fakeMsg = { chat: msg.chat, from: query.from, message_thread_id: msg.message_thread_id };

    if (data.startsWith('page:')) {
      const [, action, pageStr] = data.split(':');
      const page = parseInt(pageStr, 10) || 0;
      const users = usersForPicker('');
      await bot.editMessageReplyMarkup(
        msg.chat.id,
        msg.message_id,
        buildUserKeyboard(users, action, page)
      );
      return bot.answerCallbackQuery(query.id);
    }

    if (!data.startsWith('pick:')) {
      return bot.answerCallbackQuery(query.id);
    }

    const [, action, username] = data.split(':');
    if (!username) {
      return bot.answerCallbackQuery(query.id, { text: 'Utente non valido' });
    }

    try {
      if (action === 'reset') {
        const result = await authService.resetPasswordByAdmin({ username });
        await bot.sendMessage(msg.chat.id, result.message, threadOpts(msg));
        await bot.answerCallbackQuery(query.id, { text: 'Password reimpostata' });
      } else if (action === 'delete') {
        if (!(await canRunAdminCommands(bot, fakeMsg))) {
          return bot.answerCallbackQuery(query.id, { text: 'Operazione non autorizzata', show_alert: true });
        }
        const result = await authService.deleteAccountByUsername(username);
        await bot.sendMessage(
          msg.chat.id,
          `Account ${result.username} eliminato: ${result.trips} viaggi, ${result.photos} foto.`,
          threadOpts(msg)
        );
        await bot.answerCallbackQuery(query.id, { text: `Eliminato ${username}` });
      } else if (action === 'find') {
        if (!(await canRunAdminCommands(bot, fakeMsg))) {
          return bot.answerCallbackQuery(query.id, { text: 'Operazione non autorizzata', show_alert: true });
        }
        const user = db.getUserByUsername(username);
        if (!user) {
          return bot.answerCallbackQuery(query.id, { text: 'Utente non trovato', show_alert: true });
        }
        const { formatUserList } = require('../utils/users');
        const text = formatUserList([user]);
        await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', ...threadOpts(msg) });
        await bot.answerCallbackQuery(query.id);
      }
    } catch (err) {
      const text = err.status === 404 ? 'Utente non trovato.' : (err.message || 'Errore');
      await bot.answerCallbackQuery(query.id, { text, show_alert: true });
    }
  });
}

function threadOpts(msg) {
  return msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {};
}

module.exports = { register };
