/**
 * handlers/inline.js — Suggerimenti utenti mentre digiti @nomebot query
 */

const db = require('../../server/db');
const { userButtonLabel } = require('../utils/userPicker');

function register(bot) {
  bot.on('inline_query', async (query) => {
    const q = (query.query || '').trim();
    if (q.length === 1) {
      return bot.answerInlineQuery(query.id, [], { cache_time: 0 });
    }

    const users = q ? db.searchUsers(q) : db.getAllUsers();
    const limited = users.slice(0, 20);

    const results = [];
    for (const user of limited) {
      const { photos } = userButtonLabel(user);
      const email = user.email || 'email non impostata';
      const desc = `${email} · ${photos} foto`;

      results.push({
        type: 'article',
        id: `rp:${user.id}`,
        title: `Reset password — ${user.username}`,
        description: desc,
        input_message_content: {
          message_text: `/resetpassword ${user.username}`,
        },
      });
      results.push({
        type: 'article',
        id: `find:${user.id}`,
        title: `Ricerca — ${user.username}`,
        description: desc,
        input_message_content: {
          message_text: `/finduser ${user.username}`,
        },
      });
      results.push({
        type: 'article',
        id: `del:${user.id}`,
        title: `Elimina account — ${user.username}`,
        description: desc,
        input_message_content: {
          message_text: `/deleteaccount ${user.username}`,
        },
      });
    }

    if (!results.length) {
      results.push({
        type: 'article',
        id: 'empty',
        title: 'Nessun utente trovato',
        description: q ? `Nessun risultato per "${q}"` : 'Nessun utente registrato',
        input_message_content: { message_text: '/help' },
      });
    }

    await bot.answerInlineQuery(query.id, results, { cache_time: 2, is_personal: true });
  });
}

module.exports = { register };
