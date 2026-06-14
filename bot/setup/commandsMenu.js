/**
 * commandsMenu.js — Menu comandi Telegram (suggerimenti digitando /)
 */

const config = require('../../server/config');

const COMMANDS = [
  { command: 'help', description: 'Guida e comandi disponibili' },
  { command: 'status', description: 'Statistiche generali' },
  { command: 'users', description: 'Elenco utenti registrati' },
  { command: 'finduser', description: 'Ricerca per username o email' },
  { command: 'resetpassword', description: 'Reimposta password via email' },
  { command: 'deleteaccount', description: 'Eliminazione account' },
];

async function setupBotCommands(bot) {
  await bot.setMyCommands(COMMANDS);
  if (config.GROUP_ID) {
    await bot.setMyCommands(COMMANDS, {
      scope: { type: 'chat', chat_id: Number(config.GROUP_ID) },
    });
  }
}

module.exports = { setupBotCommands };
