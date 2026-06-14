/**
 * admin.js — Verifica permessi per comandi admin del bot
 */

const config = require('../../server/config');

async function canRunAdminCommands(bot, msg) {
  const fromId = String(msg.from?.id || '');
  if (!fromId) return false;

  if (config.BOT_ADMIN_IDS.includes(fromId)) return true;

  try {
    const member = await bot.getChatMember(msg.chat.id, msg.from.id);
    return ['creator', 'administrator'].includes(member?.status);
  } catch {
    return false;
  }
}

module.exports = { canRunAdminCommands };
