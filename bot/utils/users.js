/**
 * users.js — Formattazione elenco utenti per i comandi del bot
 */

const db = require('../../server/db');
const { escMd } = require('./escape');

function formatUserLine(user) {
  const { count } = db.getUserUsage(user.id);
  const email = user.email || '—';
  return `• *${escMd(user.username)}* — ${email} — ${count} foto`;
}

function formatUserList(users) {
  if (!users.length) return null;
  const header = `*Utenti registrati: ${users.length}*\n`;
  return header + users.map(formatUserLine).join('\n');
}

/** Spezza messaggi lunghi per il limite Telegram (~4096 caratteri). */
function chunkMessages(text, maxLen = 3800) {
  if (!text || text.length <= maxLen) return [text];
  const lines = text.split('\n');
  const chunks = [];
  let current = '';
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLen && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

module.exports = { formatUserList, chunkMessages };
